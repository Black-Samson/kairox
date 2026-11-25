/**
 * On-chain HSKSwap pricing (server-side). V3: QuoterV2.quoteExactInputSingle. V2: factory -> pair
 * reserves with the constant-product formula. Returns the DEX price in quote-per-base and the
 * estimated price impact for a trade of `tradeUsd`.
 */
import { formatUnits, parseUnits, type Address } from "viem";
import { contracts, hskswapFeeTier, hskswapVersion } from "@/config/contracts";
import type { PairConfig } from "@/config/pairs";
import { erc20Abi, quoterV2Abi, v2FactoryAbi, v2PairAbi } from "./abis";
import { getPublicClient } from "./client";

const decimalsCache = new Map<Address, number>();

export async function tokenDecimals(token: Address): Promise<number> {
  const hit = decimalsCache.get(token);
  if (hit !== undefined) return hit;
  const d = Number(await getPublicClient().readContract({ address: token, abi: erc20Abi, functionName: "decimals" }));
  decimalsCache.set(token, d);
  return d;
}

/** Exact-input quote: how much `tokenOut` for `amountIn` (raw units) of `tokenIn`. */
export async function quoteExactIn(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> {
  const client = getPublicClient();
  if (!contracts.quoter) throw new Error("HSKSwap quoter/factory address not configured");

  if (hskswapVersion === "v3") {
    const [amountOut] = await client.readContract({
      address: contracts.quoter,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee: hskswapFeeTier, sqrtPriceLimitX96: 0n }],
    });
    return amountOut;
  }

  // V2: NEXT_PUBLIC_HSKSWAP_QUOTER_ADDRESS holds the factory.
  const pairAddr = await client.readContract({
    address: contracts.quoter,
    abi: v2FactoryAbi,
    functionName: "getPair",
    args: [tokenIn, tokenOut],
  });
  if (/^0x0{40}$/i.test(pairAddr)) throw new Error("No HSKSwap V2 pool for this pair");
  const [token0, reserves] = await Promise.all([
    client.readContract({ address: pairAddr, abi: v2PairAbi, functionName: "token0" }),
    client.readContract({ address: pairAddr, abi: v2PairAbi, functionName: "getReserves" }),
  ]);
  const [r0, r1] = [reserves[0], reserves[1]];
  const [reserveIn, reserveOut] = token0.toLowerCase() === tokenIn.toLowerCase() ? [r0, r1] : [r1, r0];
  const amountInWithFee = amountIn * 997n;
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
}

export interface DexQuote {
  price: number; // quote per base (mid, from a small probe)
  impactPct: number; // impact for a buy of tradeUsd
  baseDecimals: number;
  quoteDecimals: number;
}

export async function getDexQuote(pair: PairConfig, tradeUsd: number): Promise<DexQuote> {
  const base = pair.base.address;
  const quote = pair.quote.address;
  if (!base || !quote) throw new Error(`Token addresses for ${pair.id} not configured`);
  const [baseDecimals, quoteDecimals] = await Promise.all([tokenDecimals(base), tokenDecimals(quote)]);

  const probeIn = parseUnits("1", quoteDecimals);
  const tradeIn = parseUnits(Math.max(1, tradeUsd).toFixed(quoteDecimals), quoteDecimals);
  const [probeOut, tradeOut] = await Promise.all([
    quoteExactIn(quote, base, probeIn),
    quoteExactIn(quote, base, tradeIn),
  ]);
  const probeRate = Number(formatUnits(probeOut, baseDecimals)); // base per 1 quote
  const tradeRate = Number(formatUnits(tradeOut, baseDecimals)) / Math.max(1, tradeUsd);
  if (!probeRate) throw new Error("Empty HSKSwap quote");
  return {
    price: 1 / probeRate,
    impactPct: Math.max(0, ((probeRate - tradeRate) / probeRate) * 100),
    baseDecimals,
    quoteDecimals,
  };
}
