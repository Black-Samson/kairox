/**
 * On-chain swap executor (server-side only). The agent wallet (AGENT_PRIVATE_KEY) is the vault's
 * *operator*: it submits KairoxVault.executeTrade with HSKSwap router calldata whose recipient is
 * the vault. The vault re-checks every guardrail on-chain and verifies the swap output.
 */
import {
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  fallback,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeChain } from "@/config/chains";
import { contracts, hskswapFeeTier, hskswapVersion } from "@/config/contracts";
import type { PairConfig } from "@/config/pairs";
import { swapRouter02Abi, swapRouterV1Abi, v2RouterAbi } from "./abis";
import { getPublicClient } from "./client";
import { kairoxVaultAbi } from "./kairoxVaultAbi";
import { quoteExactIn, tokenDecimals } from "./quoter";

export function agentConfigured(): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(process.env.AGENT_PRIVATE_KEY ?? "");
}

function agentAccount() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key || !agentConfigured()) throw new Error("AGENT_PRIVATE_KEY not set");
  return privateKeyToAccount(key as Hex);
}

export function agentAddress(): Address | undefined {
  return agentConfigured() ? agentAccount().address : undefined;
}

function walletClient() {
  const urls = process.env.HSK_RPC_URL
    ? [process.env.HSK_RPC_URL, ...activeChain.rpcUrls.default.http]
    : [...activeChain.rpcUrls.default.http];
  return createWalletClient({
    account: agentAccount(),
    chain: activeChain,
    transport: fallback(urls.map((u) => http(u, { timeout: 15000 }))),
  });
}

/** Router calldata for an exact-input swap whose output goes to `recipient` (the vault). */
export function buildRouterCalldata(p: {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minOut: bigint;
  recipient: Address;
}): Hex {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  if (hskswapVersion === "v2") {
    return encodeFunctionData({
      abi: v2RouterAbi,
      functionName: "swapExactTokensForTokens",
      args: [p.amountIn, p.minOut, [p.tokenIn, p.tokenOut], p.recipient, deadline],
    });
  }
  if (process.env.NEXT_PUBLIC_HSKSWAP_V3_ROUTER_TYPE === "swaprouter") {
    return encodeFunctionData({
      abi: swapRouterV1Abi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: p.tokenIn,
          tokenOut: p.tokenOut,
          fee: hskswapFeeTier,
          recipient: p.recipient,
          deadline,
          amountIn: p.amountIn,
          amountOutMinimum: p.minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
  }
  return encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        fee: hskswapFeeTier,
        recipient: p.recipient,
        amountIn: p.amountIn,
        amountOutMinimum: p.minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
}

export interface VaultTradeRequest {
  pair: PairConfig;
  side: "BUY" | "SELL";
  /** BUY: quote amount (e.g. "25.5" USDT). SELL: base amount, or "all" for the whole tracked position. */
  amount: string;
  maxSlippagePct: number;
  reasonHash: Hex;
  signalScoreBps: number;
}

export interface VaultTradeResult {
  txHash: Hex;
  amountIn: number;
  amountOut: number;
  price: number; // quote per base
  realizedPnl: number; // quote units, from the vault event
}

export async function executeVaultTrade(req: VaultTradeRequest): Promise<VaultTradeResult> {
  const vault = contracts.vault;
  const base = req.pair.base.address;
  const quote = req.pair.quote.address;
  if (!vault || !contracts.router) throw new Error("Vault / router not configured");
  if (!base || !quote) throw new Error(`Token addresses for ${req.pair.id} not configured`);
  if (req.maxSlippagePct <= 0 || req.maxSlippagePct > 5) throw new Error("maxSlippagePct out of range");

  const client = getPublicClient();
  const [baseDec, quoteDec] = await Promise.all([tokenDecimals(base), tokenDecimals(quote)]);
  const [tokenIn, tokenOut, inDec, outDec] =
    req.side === "BUY" ? [quote, base, quoteDec, baseDec] : [base, quote, baseDec, quoteDec];

  let amountIn: bigint;
  if (req.side === "SELL" && req.amount === "all") {
    const [size] = await client.readContract({ address: vault, abi: kairoxVaultAbi, functionName: "positions", args: [base] });
    amountIn = size;
  } else {
    amountIn = parseUnits(Number(req.amount).toFixed(inDec), inDec);
  }
  if (amountIn === 0n) throw new Error("Nothing to trade");

  // Fresh quote right before sending; minOut enforces the user's slippage tolerance.
  const expectedOut = await quoteExactIn(tokenIn, tokenOut, amountIn);
  const slipBps = BigInt(Math.round(req.maxSlippagePct * 100));
  const minOut = (expectedOut * (10_000n - slipBps)) / 10_000n;
  if (minOut === 0n) throw new Error("Quote too small");

  const routerCalldata = buildRouterCalldata({ tokenIn, tokenOut, amountIn, minOut, recipient: vault });
  const wallet = walletClient();

  const { request } = await client.simulateContract({
    account: wallet.account,
    address: vault,
    abi: kairoxVaultAbi,
    functionName: "executeTrade",
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn,
        minAmountOut: minOut,
        routerCalldata,
        reasonHash: req.reasonHash,
        signalScoreBps: Math.max(0, Math.min(10_000, Math.round(req.signalScoreBps))),
      },
    ],
  });
  const txHash = await wallet.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`Trade reverted (${txHash})`);

  let spent = amountIn;
  let received = expectedOut;
  let realized = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: kairoxVaultAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "TradeExecuted") {
        spent = ev.args.amountIn;
        received = ev.args.amountOut;
        realized = ev.args.realizedPnlQuote;
      }
    } catch {
      /* other events */
    }
  }

  const amountInNum = Number(formatUnits(spent, inDec));
  const amountOutNum = Number(formatUnits(received, outDec));
  const price = req.side === "BUY" ? amountInNum / amountOutNum : amountOutNum / amountInNum;
  return {
    txHash,
    amountIn: amountInNum,
    amountOut: amountOutNum,
    price,
    realizedPnl: Number(formatUnits(realized < 0n ? -realized : realized, quoteDec)) * (realized < 0n ? -1 : 1),
  };
}

export async function readVaultStatus() {
  const vault = contracts.vault;
  if (!vault) return null;
  const client = getPublicClient();
  const quote = contracts.usdt;
  const [status, limits, owner, operator, quoteDec] = await Promise.all([
    client.readContract({ address: vault, abi: kairoxVaultAbi, functionName: "status" }),
    client.readContract({ address: vault, abi: kairoxVaultAbi, functionName: "getLimits" }),
    client.readContract({ address: vault, abi: kairoxVaultAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: kairoxVaultAbi, functionName: "operator" }),
    quote ? tokenDecimals(quote) : Promise.resolve(6),
  ]);
  const q = (v: bigint) => Number(formatUnits(v < 0n ? -v : v, quoteDec)) * (v < 0n ? -1 : 1);
  return {
    address: vault,
    owner,
    operator,
    paused: status[0],
    lossHalted: status[1],
    dailyRealizedPnl: q(status[2]),
    openExposure: q(status[3]),
    tradeCount: Number(status[4]),
    quoteBalance: q(status[5]),
    limits: {
      maxTradeQuote: q(limits.maxTradeQuote),
      maxOpenExposureQuote: q(limits.maxOpenExposureQuote),
      dailyLossLimitQuote: q(limits.dailyLossLimitQuote),
      maxSlippagePct: limits.maxSlippageBps / 100,
      minTradeInterval: limits.minTradeInterval,
    },
  };
}

export type VaultStatus = NonNullable<Awaited<ReturnType<typeof readVaultStatus>>>;
