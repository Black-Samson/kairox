/**
 * TEST-ONLY: deploys a full mock trading setup on HashKey Chain TESTNET (chainId 133), for when
 * HSKSwap is not available there. Refuses to run on any other chain (except a local Hardhat chain,
 * 31337, for a dry run).
 *
 *   npm run deploy:testnet-mocks
 *
 * Deploys, in order:
 *   1. mock USDT (6 decimals) and mock WHSK (18 decimals) — MockERC20, anyone can mint
 *   2. MockSwapRouter02 + MockQuoterV2, priced at the current HSK/USDT price
 *   3. funds the router with both tokens
 *   4. KairoxVault with small limits, quote = mock USDT, router = mock router; allowlists mock WHSK
 *   5. mints test USDT to the deployer (owner), so you can deposit it from the app
 * and prints a ready-to-paste block for the app's .env.local.
 *
 * Env (contracts/.env or exported in your shell):
 *   DEPLOYER_PRIVATE_KEY     testnet wallet that becomes the owner (needs testnet HSK for gas)
 *   AGENT_OPERATOR_ADDRESS   address of the agent's hot wallet (the one AGENT_PRIVATE_KEY belongs to)
 * Optional:
 *   MOCK_HSK_PRICE           USDT per HSK; skips the live price lookup (Gate, then MEXC)
 *   MOCK_DEX_DISCOUNT_BPS    price the mock DEX this many bps below the reference (default 0).
 *                            The agent only buys at a discount (default entry spread 0.40% = 40 bps).
 */
import hre from "hardhat";
import { getAddress, isAddress, parseUnits } from "viem";
import fs from "node:fs";
import path from "node:path";

const TESTNET_CHAIN_ID = 133;
const LOCAL_CHAIN_ID = 31337;

const USDT_DECIMALS = 6;
const WHSK_DECIMALS = 18;
const FEE_TIER = 3000; // ignored by the mocks; set so the app and the mocks agree
const PRICE_SCALE = 10n ** 8n;

// Small on-chain limits for testing (USDT).
const LIMITS = { maxTrade: "10", maxExposure: "30", dailyLoss: "5", maxSlippageBps: 100, minTradeInterval: 30 };
// Liquidity minted to the router, and test USDT minted to the deployer.
const ROUTER_USDT = "100000";
const ROUTER_WHSK = "2000000";
const DEPLOYER_USDT = "1000";

function requireAddress(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !isAddress(value)) throw new Error(`Missing or invalid ${name}.`);
  return getAddress(value);
}

async function fetchHskPrice(): Promise<{ price: number; source: string }> {
  const override = process.env.MOCK_HSK_PRICE;
  if (override) {
    const price = Number(override);
    if (!(price > 0)) throw new Error(`Invalid MOCK_HSK_PRICE=${override}`);
    return { price, source: "MOCK_HSK_PRICE" };
  }
  const sources: [string, string, (j: any) => unknown][] = [
    ["gate", "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=HSK_USDT", (j) => j?.[0]?.last],
    ["mexc", "https://api.mexc.com/api/v3/ticker/price?symbol=HSKUSDT", (j) => j?.price],
  ];
  for (const [name, url, pick] of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const price = Number(pick(await res.json()));
      if (res.ok && price > 0) return { price, source: name };
    } catch {
      /* try the next source */
    }
  }
  throw new Error("Could not fetch the HSK price from Gate or MEXC. Set MOCK_HSK_PRICE (USDT per HSK) and retry.");
}

async function main() {
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  if (chainId !== TESTNET_CHAIN_ID && chainId !== LOCAL_CHAIN_ID) {
    throw new Error(`Refusing to deploy TEST-ONLY mocks on chainId ${chainId}. Use --network hashkeyTestnet (133).`);
  }
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in contracts/.env.");
  const owner = deployer.account.address;
  const operator = requireAddress("AGENT_OPERATOR_ADDRESS");
  if (getAddress(operator) === getAddress(owner)) {
    throw new Error("AGENT_OPERATOR_ADDRESS must be a separate agent wallet, not the owner/deployer.");
  }

  const discountBps = BigInt(process.env.MOCK_DEX_DISCOUNT_BPS ?? "0");
  if (discountBps < 0n || discountBps >= 10_000n) throw new Error("MOCK_DEX_DISCOUNT_BPS must be 0..9999");
  const { price, source } = await fetchHskPrice();
  const refPriceE8 = BigInt(Math.round(price * 1e8));
  const dexPriceE8 = (refPriceE8 * (10_000n - discountBps)) / 10_000n;
  if (dexPriceE8 === 0n) throw new Error("HSK price too small to encode");

  const wait = async (hash: `0x${string}`) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  };

  console.log(`Network:   ${hre.network.name} (chainId ${chainId})${chainId === LOCAL_CHAIN_ID ? "  [local dry run]" : ""}`);
  console.log(`Owner:     ${owner}`);
  console.log(`Operator:  ${operator}`);
  console.log(`HSK price: ${price} USDT (${source}); mock DEX at ${Number(dexPriceE8) / 1e8} (-${discountBps} bps)\n`);

  // 1. Tokens
  const usdt = await hre.viem.deployContract("MockERC20", ["Kairox Test USDT", "USDT", USDT_DECIMALS]);
  console.log(`Mock USDT:        ${usdt.address}`);
  const whsk = await hre.viem.deployContract("MockERC20", ["Kairox Test Wrapped HSK", "WHSK", WHSK_DECIMALS]);
  console.log(`Mock WHSK:        ${whsk.address}`);

  // 2. Router + quoter. Raw-unit rates: USDT -> WHSK = 10^18 / (10^6 * price); WHSK -> USDT = inverse.
  const router = await hre.viem.deployContract("MockSwapRouter02");
  console.log(`MockSwapRouter02: ${router.address}`);
  const quoter = await hre.viem.deployContract("MockQuoterV2", [router.address]);
  console.log(`MockQuoterV2:     ${quoter.address}`);
  const baseUnit = 10n ** BigInt(WHSK_DECIMALS);
  const quoteUnit = 10n ** BigInt(USDT_DECIMALS);
  await wait(await router.write.setRate([usdt.address, whsk.address, baseUnit * PRICE_SCALE, quoteUnit * dexPriceE8]));
  await wait(await router.write.setRate([whsk.address, usdt.address, quoteUnit * dexPriceE8, baseUnit * PRICE_SCALE]));

  // 3. Router liquidity
  await wait(await usdt.write.mint([router.address, parseUnits(ROUTER_USDT, USDT_DECIMALS)]));
  await wait(await whsk.write.mint([router.address, parseUnits(ROUTER_WHSK, WHSK_DECIMALS)]));
  console.log(`Router funded:    ${ROUTER_USDT} USDT + ${ROUTER_WHSK} WHSK`);

  // 4. Vault
  const q = (n: string) => parseUnits(n, USDT_DECIMALS);
  const limits = {
    maxTradeQuote: q(LIMITS.maxTrade),
    maxOpenExposureQuote: q(LIMITS.maxExposure),
    dailyLossLimitQuote: q(LIMITS.dailyLoss),
    maxSlippageBps: LIMITS.maxSlippageBps,
    minTradeInterval: LIMITS.minTradeInterval,
  };
  const vault = await hre.viem.deployContract("KairoxVault", [owner, usdt.address, router.address, operator, limits]);
  console.log(`KairoxVault:      ${vault.address}`);
  await wait(await vault.write.setAllowedToken([whsk.address, true]));
  console.log(
    `Vault limits:     max trade ${LIMITS.maxTrade} · exposure ${LIMITS.maxExposure} · daily loss ${LIMITS.dailyLoss} USDT · ` +
      `slippage ${LIMITS.maxSlippageBps} bps · ${LIMITS.minTradeInterval}s between entries; WHSK allowlisted`,
  );

  // 5. Test USDT for the owner
  await wait(await usdt.write.mint([owner, parseUnits(DEPLOYER_USDT, USDT_DECIMALS)]));
  console.log(`Minted ${DEPLOYER_USDT} test USDT to the owner`);

  const out = path.join(__dirname, "..", "deployments", `${hre.network.name}-mocks.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        testOnly: true,
        chainId,
        owner,
        operator,
        usdt: usdt.address,
        whsk: whsk.address,
        router: router.address,
        quoter: quoter.address,
        vault: vault.address,
        hskPrice: { reference: price, source, dex: Number(dexPriceE8) / 1e8, discountBps: Number(discountBps) },
        limits: Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v.toString()])),
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\nSaved ${out}`);

  console.log(`
# ── Paste into the app's .env.local (repo root) ── TEST-ONLY mocks on HashKey testnet ──
NEXT_PUBLIC_HSK_NETWORK=testnet
NEXT_PUBLIC_HSKSWAP_VERSION=v3
NEXT_PUBLIC_HSKSWAP_ROUTER_ADDRESS=${router.address}
NEXT_PUBLIC_HSKSWAP_QUOTER_ADDRESS=${quoter.address}
NEXT_PUBLIC_HSKSWAP_FEE_TIER=${FEE_TIER}
NEXT_PUBLIC_HSKSWAP_V3_ROUTER_TYPE=swaprouter02
NEXT_PUBLIC_WHSK_ADDRESS=${whsk.address}
NEXT_PUBLIC_USDT_ADDRESS=${usdt.address}
NEXT_PUBLIC_USDC_ADDRESS=
NEXT_PUBLIC_KAIROX_VAULT_ADDRESS=${vault.address}
# AGENT_PRIVATE_KEY: set it yourself to the key of ${operator} (server-only, never commit it)
# ─────────────────────────────────────────────────────────────────────────────────────────
`);
  console.log("Next: restart `npm run dev`, connect the OWNER wallet on testnet, Vault tab → Deposit USDT → Enable live trading.");
  console.log("The agent wallet needs a little testnet HSK for gas.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
