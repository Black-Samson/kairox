import { getAddress, isAddress, type Address } from "viem";

/**
 * Contract addresses are read ONLY from env. Nothing is hardcoded or guessed.
 * Missing / invalid values never crash the app: Kairox falls back to
 * "Live Market + Sandbox Execution" and shows why in the top bar.
 *
 * NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.
 */
const raw = {
  router: process.env.NEXT_PUBLIC_HSKSWAP_ROUTER_ADDRESS,
  quoter: process.env.NEXT_PUBLIC_HSKSWAP_QUOTER_ADDRESS,
  whsk: process.env.NEXT_PUBLIC_WHSK_ADDRESS,
  usdt: process.env.NEXT_PUBLIC_USDT_ADDRESS,
  usdc: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  vault: process.env.NEXT_PUBLIC_KAIROX_VAULT_ADDRESS,
};

export type HskSwapVersion = "v2" | "v3";

function parse(value: string | undefined): Address | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return isAddress(v) ? getAddress(v) : undefined;
}

export const contracts = {
  router: parse(raw.router),
  quoter: parse(raw.quoter),
  whsk: parse(raw.whsk),
  usdt: parse(raw.usdt),
  usdc: parse(raw.usdc),
  vault: parse(raw.vault),
};

export const hskswapVersion: HskSwapVersion =
  process.env.NEXT_PUBLIC_HSKSWAP_VERSION === "v2" ? "v2" : "v3";

/** V3 pool fee tier (500 = 0.05%, 3000 = 0.3%, 10000 = 1%). */
export const hskswapFeeTier = Number(process.env.NEXT_PUBLIC_HSKSWAP_FEE_TIER ?? 3000);

/** Problems with the configured addresses, for the status indicator and README troubleshooting. */
export const contractIssues: string[] = (() => {
  const issues: string[] = [];
  const check = (key: keyof typeof raw, label: string, required: boolean) => {
    const value = raw[key];
    if (!value) {
      if (required) issues.push(`${label} not set`);
    } else if (!isAddress(value.trim())) {
      issues.push(`${label} is not a valid address`);
    }
  };
  check("router", "NEXT_PUBLIC_HSKSWAP_ROUTER_ADDRESS", true);
  check("quoter", "NEXT_PUBLIC_HSKSWAP_QUOTER_ADDRESS", true);
  check("whsk", "NEXT_PUBLIC_WHSK_ADDRESS", true);
  check("usdt", "NEXT_PUBLIC_USDT_ADDRESS", true);
  check("usdc", "NEXT_PUBLIC_USDC_ADDRESS", false);
  check("vault", "NEXT_PUBLIC_KAIROX_VAULT_ADDRESS", true);
  return issues;
})();

/** On-chain market data is available when HSKSwap + tokens are configured. */
export const onchainMarketReady = Boolean(contracts.router && contracts.quoter && contracts.whsk && contracts.usdt);

/** Live execution needs on-chain market data AND a deployed KairoxVault. (The agent key is checked server-side.) */
export const vaultReady = onchainMarketReady && Boolean(contracts.vault);
