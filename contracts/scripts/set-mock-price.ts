/**
 * TEST-ONLY: move the price of the mock HSKSwap deployed by deploy-testnet-mocks.ts, so you can
 * trigger agent behaviour on testnet (a mock DEX has a fixed price, so nothing moves on its own).
 *
 * From Git Bash, inside contracts/:
 *   MOCK_DEX_DISCOUNT_BPS=80 npm run mock:price   # DEX 0.80% below the live HSK price -> agent buys
 *   MOCK_DEX_DISCOUNT_BPS=-300 npm run mock:price # DEX 3% above live price -> open position hits take-profit
 *   MOCK_PRICE=0.075 npm run mock:price           # set an exact price (USDT per HSK)
 *
 * Uses DEPLOYER_PRIVATE_KEY (the mock router owner) and deployments/hashkeyTestnet-mocks.json.
 * Refuses to run on anything but HashKey testnet (133) or a local Hardhat chain (31337).
 */
import "dotenv/config";
import hre from "hardhat";
import fs from "node:fs";
import path from "node:path";

const PRICE_SCALE = 10n ** 8n;

async function livePrice(): Promise<number> {
  for (const url of [
    "https://api.gateio.ws/api/v4/spot/tickers?currency_pair=HSK_USDT",
    "https://api.mexc.com/api/v3/ticker/price?symbol=HSKUSDT",
  ]) {
    try {
      const res = await fetch(url);
      const data = (await res.json()) as { last?: string; price?: string }[] | { price?: string };
      const price = Number(Array.isArray(data) ? data[0]?.last : data.price);
      if (price > 0) return price;
    } catch {
      /* next source */
    }
  }
  throw new Error("Could not fetch the live HSK price; set MOCK_PRICE instead.");
}

async function main() {
  const chainId = await (await hre.viem.getPublicClient()).getChainId();
  if (chainId !== 133 && chainId !== 31337) throw new Error(`Refusing to run on chain ${chainId} (testnet mocks only).`);

  const file = path.join(__dirname, "..", "deployments", "hashkeyTestnet-mocks.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8")) as { router: `0x${string}`; usdt: `0x${string}`; whsk: `0x${string}` };

  let price: number;
  if (process.env.MOCK_PRICE) {
    price = Number(process.env.MOCK_PRICE);
  } else {
    const ref = await livePrice();
    const bps = Number(process.env.MOCK_DEX_DISCOUNT_BPS ?? 80);
    price = ref * (1 - bps / 10_000);
    console.log(`Live HSK price ${ref}; mock DEX ${bps >= 0 ? `${bps} bps below` : `${-bps} bps above`} it.`);
  }
  if (!(price > 0)) throw new Error("Invalid price");
  const priceE8 = BigInt(Math.round(price * 1e8));

  const router = await hre.viem.getContractAt("MockSwapRouter02", dep.router);
  const pub = await hre.viem.getPublicClient();
  const baseUnit = 10n ** 18n;
  const quoteUnit = 10n ** 6n;
  await pub.waitForTransactionReceipt({
    hash: await router.write.setRate([dep.usdt, dep.whsk, baseUnit * PRICE_SCALE, quoteUnit * priceE8]),
  });
  await pub.waitForTransactionReceipt({
    hash: await router.write.setRate([dep.whsk, dep.usdt, quoteUnit * priceE8, baseUnit * PRICE_SCALE]),
  });
  console.log(`Mock HSKSwap price set to ${Number(priceE8) / 1e8} USDT per HSK.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
