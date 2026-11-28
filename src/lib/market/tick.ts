/** Server-side market tick: HSKSwap on-chain price when configured, else a labelled simulated DEX. */
import { onchainMarketReady } from "@/config/contracts";
import { PAIRS, type PairId } from "@/config/pairs";
import type { MarketTick } from "@/lib/agent/types";
import { getDexQuote } from "@/lib/chain/quoter";
import { getReferencePrice } from "./reference";
import { simulatedSpreadPct } from "./synthetic";

export async function getMarketTick(pairId: PairId, tradeUsd: number): Promise<MarketTick & { warning?: string }> {
  const pair = PAIRS[pairId];
  const now = Date.now();
  const ref = await getReferencePrice(pair, now);

  if (onchainMarketReady && pair.base.address && pair.quote.address) {
    try {
      const q = await getDexQuote(pair, tradeUsd);
      return {
        pair: pairId,
        time: now,
        dexPrice: q.price,
        refPrice: ref.price,
        spreadPct: ((ref.price - q.price) / q.price) * 100,
        priceImpactPct: q.impactPct,
        change24hPct: ref.change24hPct,
        volume24h: ref.volume24h,
        source: { dex: "hskswap", ref: ref.source },
      };
    } catch (err) {
      const sim = simulated(pairId, ref, now);
      return { ...sim, warning: `HSKSwap quote failed (${(err as Error).message}); showing simulated DEX` };
    }
  }
  return simulated(pairId, ref, now);
}

function simulated(
  pair: PairId,
  ref: { price: number; source: string; change24hPct?: number; volume24h?: number },
  now: number,
): MarketTick {
  const spread = simulatedSpreadPct(now);
  const dexPrice = ref.price / (1 + spread / 100);
  return {
    pair,
    time: now,
    dexPrice,
    refPrice: ref.price,
    spreadPct: ((ref.price - dexPrice) / dexPrice) * 100,
    priceImpactPct: 0.12,
    change24hPct: ref.change24hPct,
    volume24h: ref.volume24h,
    source: { dex: "simulated", ref: ref.source },
  };
}
