/**
 * External spot reference price for HSK (server-side). Tries public CEX/aggregator APIs in order,
 * caches briefly, and falls back to a labelled synthetic price so the terminal never stalls.
 */
import type { PairConfig } from "@/config/pairs";
import type { Candle } from "@/lib/agent/types";
import { syntheticCandles, syntheticRefPrice } from "./synthetic";
import { TIMEFRAMES, type Timeframe } from "./timeframes";

const TIMEOUT_MS = 2500;
const CACHE_MS = 3000;

type RefResult = { price: number; source: string; change24hPct?: number; volume24h?: number };
type Quote = { price: number; change24hPct?: number; volume24h?: number };
const cache = new Map<string, { at: number; value: RefResult }>();
let lastLivePrice: number | undefined;

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const sources: Record<string, (p: PairConfig) => Promise<Quote>> = {
  gate: async (p) => {
    const data = (await getJson(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${p.reference.gate}`)) as {
      last: string;
      change_percentage?: string;
      base_volume?: string;
    }[];
    const t = data[0];
    return { price: Number(t?.last), change24hPct: num(t?.change_percentage), volume24h: num(t?.base_volume) };
  },
  mexc: async (p) => {
    const t = (await getJson(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${p.reference.mexc}`)) as {
      lastPrice: string;
      priceChangePercent?: string;
      volume?: string;
    };
    // MEXC reports the change as a fraction (0.0123 = 1.23%).
    const ch = num(t.priceChangePercent);
    return { price: Number(t.lastPrice), change24hPct: ch === undefined ? undefined : ch * 100, volume24h: num(t.volume) };
  },
  coingecko: async (p) => {
    const id = p.reference.coingeckoId;
    const data = (await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`,
    )) as Record<string, { usd: number; usd_24h_change?: number }>;
    return { price: Number(data[id]?.usd), change24hPct: data[id]?.usd_24h_change };
  },
};

function num(v: string | number | undefined): number | undefined {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? undefined : n;
}

function sourceOrder(): string[] {
  const env = process.env.REFERENCE_SOURCES; // e.g. "gate,mexc,coingecko"
  const list = env ? env.split(",").map((s) => s.trim()) : ["gate", "mexc", "coingecko"];
  return list.filter((s) => s in sources);
}

export async function getReferencePrice(pair: PairConfig, now = Date.now()): Promise<RefResult> {
  const key = pair.reference.gate;
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  if (process.env.REFERENCE_OFFLINE !== "1") {
    for (const name of sourceOrder()) {
      try {
        const q = await sources[name](pair);
        const price = q.price;
        if (Number.isFinite(price) && price > 0) {
          const value = { ...q, source: name };
          lastLivePrice = price;
          cache.set(key, { at: now, value });
          return value;
        }
      } catch {
        /* try next source */
      }
    }
  }
  // Anchor the synthetic walk to the last live price if we ever had one.
  const value = { price: syntheticRefPrice(now, lastLivePrice), source: "synthetic" };
  cache.set(key, { at: now, value });
  return value;
}

export async function getReferenceHistory(
  pair: PairConfig,
  timeframe: Timeframe = "1m",
  count = 200,
): Promise<{ candles: Candle[]; source: string; timeframe: Timeframe }> {
  const tf = TIMEFRAMES[timeframe];
  if (process.env.REFERENCE_OFFLINE !== "1") {
    try {
      const data = (await getJson(
        `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair.reference.gate}&interval=${tf.gate}&limit=${count}`,
      )) as string[][];
      // gate: [t, quoteVol, close, high, low, open, baseVol, closed]
      const candles = data
        .map((r) => ({ time: Number(r[0]), close: +r[2], high: +r[3], low: +r[4], open: +r[5], volume: +r[6] }))
        .filter((c) => c.close > 0)
        .sort((a, b) => a.time - b.time);
      if (candles.length > 10) return { candles, source: "gate", timeframe };
    } catch (err) {
      console.warn(`[kairox] Gate history failed: ${(err as Error).message}`);
    }
    try {
      const data = (await getJson(
        `https://api.mexc.com/api/v3/klines?symbol=${pair.reference.mexc}&interval=${tf.mexc}&limit=${count}`,
      )) as (string | number)[][];
      // mexc: [openTime(ms), open, high, low, close, volume, ...]
      const candles = data.map((r) => ({
        time: Math.floor(Number(r[0]) / 1000),
        open: +r[1],
        high: +r[2],
        low: +r[3],
        close: +r[4],
        volume: +r[5],
      }));
      if (candles.length > 10) return { candles, source: "mexc", timeframe };
    } catch (err) {
      console.warn(`[kairox] MEXC history failed: ${(err as Error).message}`);
    }
  }
  // Anchor the synthetic history to the CURRENT reference price so it joins the live candles.
  const ref = await getReferencePrice(pair);
  return { candles: syntheticCandles(Date.now(), count, tf.sec, ref.price), source: "synthetic", timeframe };
}
