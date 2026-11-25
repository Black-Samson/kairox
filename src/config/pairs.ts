import type { Address } from "viem";
import { contracts } from "./contracts";

export type PairId = "HSK/USDT" | "HSK/USDC";

export interface PairConfig {
  id: PairId;
  base: { symbol: string; address?: Address; decimals: number };
  quote: { symbol: string; address?: Address; decimals: number };
  /** Gate.io / MEXC style symbols for the external reference price. */
  reference: { gate: string; mexc: string; coingeckoId: string };
}

// HSK is the native gas token; HSKSwap pools trade the wrapped ERC-20 (WHSK).
// Decimals here are defaults — the server re-reads them on-chain before trading.
export const PAIRS: Record<PairId, PairConfig> = {
  "HSK/USDT": {
    id: "HSK/USDT",
    base: { symbol: "HSK", address: contracts.whsk, decimals: 18 },
    quote: { symbol: "USDT", address: contracts.usdt, decimals: 6 },
    reference: { gate: "HSK_USDT", mexc: "HSKUSDT", coingeckoId: "hashkey-ecopoints" },
  },
  "HSK/USDC": {
    id: "HSK/USDC",
    base: { symbol: "HSK", address: contracts.whsk, decimals: 18 },
    quote: { symbol: "USDC", address: contracts.usdc, decimals: 6 },
    reference: { gate: "HSK_USDT", mexc: "HSKUSDT", coingeckoId: "hashkey-ecopoints" },
  },
};

export const PAIR_IDS = Object.keys(PAIRS) as PairId[];

export const isPairId = (v: unknown): v is PairId => typeof v === "string" && v in PAIRS;

/** A pair can trade live only if its quote token is the vault's quote token (USDT by default). */
export function pairLiveCapable(id: PairId): boolean {
  const p = PAIRS[id];
  return Boolean(p.base.address && p.quote.address && p.quote.address === contracts.usdt);
}
