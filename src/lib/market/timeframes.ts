/** Chart timeframes and how each maps to exchange kline intervals. */
export const TIMEFRAMES = {
  "1m": { sec: 60, gate: "1m", mexc: "1m" },
  "5m": { sec: 300, gate: "5m", mexc: "5m" },
  "15m": { sec: 900, gate: "15m", mexc: "15m" },
  "1h": { sec: 3600, gate: "1h", mexc: "60m" },
  "4h": { sec: 14_400, gate: "4h", mexc: "4h" },
  "1D": { sec: 86_400, gate: "1d", mexc: "1d" },
} as const;

export type Timeframe = keyof typeof TIMEFRAMES;
export const TIMEFRAME_IDS = Object.keys(TIMEFRAMES) as Timeframe[];
export const isTimeframe = (v: unknown): v is Timeframe => typeof v === "string" && v in TIMEFRAMES;

/** Candle interval used by the scripted Demo Replay (it plays one step per second). */
export const REPLAY_INTERVAL_SEC = 5;
