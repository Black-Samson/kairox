/**
 * Demo replay: a scripted, deterministic market that walks through every agent behaviour in about
 * three minutes (1 step per second): a DEX discount that converges into a take-profit, a discount
 * that turns into a dump and hits the stop-loss, a quiet stretch, a spread-convergence exit, and a
 * DEX premium the long-only agent correctly ignores.
 *
 * Used for live pitches, where a real market may sit flat for the whole demo.
 */
import type { PairId } from "@/config/pairs";
import type { MarketTick } from "@/lib/agent/types";

export const REPLAY_LENGTH = 200;
const BASE = 0.14;

/** Piecewise path: [step, refMultiplier, spread%] keyframes, linearly interpolated. */
const KEYFRAMES: [number, number, number][] = [
  [0, 1.0, 0.05],
  [15, 1.002, 0.1],
  // Act 1 — DEX lags a rally: discount opens, then DEX catches up and overshoots -> TAKE PROFIT
  [22, 1.006, 0.62],
  [26, 1.01, 0.7],
  [40, 1.03, 0.15],
  [48, 1.042, -0.05],
  [60, 1.04, 0.02],
  // Act 2 — discount opens in a calm market, then the market dumps -> STOP LOSS
  [66, 1.042, 0.55],
  [70, 1.043, 0.62],
  [74, 1.041, 0.45],
  [86, 1.0, 0.2],
  [96, 0.99, 0.1],
  [112, 0.995, 0.05],
  // Act 3 — premium on DEX (long-only agent skips)
  [120, 1.0, -0.6],
  [130, 1.002, -0.4],
  [140, 1.0, 0.0],
  // Act 4 — clean discount that simply closes -> SPREAD CONVERGED
  [150, 1.004, 0.58],
  [156, 1.006, 0.6],
  [172, 1.02, 0.0],
  [185, 1.021, 0.03],
  [199, 1.02, 0.02],
];

function interp(step: number): { mult: number; spread: number } {
  const s = ((step % REPLAY_LENGTH) + REPLAY_LENGTH) % REPLAY_LENGTH;
  for (let i = 1; i < KEYFRAMES.length; i++) {
    const [s1, m1, p1] = KEYFRAMES[i];
    const [s0, m0, p0] = KEYFRAMES[i - 1];
    if (s <= s1) {
      const f = (s - s0) / (s1 - s0 || 1);
      return { mult: m0 + (m1 - m0) * f, spread: p0 + (p1 - p0) * f };
    }
  }
  const last = KEYFRAMES[KEYFRAMES.length - 1];
  return { mult: last[1], spread: last[2] };
}

export function replayTick(pair: PairId, step: number, timeMs: number): MarketTick {
  const { mult, spread } = interp(step);
  const wiggle = 1 + 0.0008 * Math.sin(step * 1.7) + 0.0005 * Math.sin(step * 4.3);
  const refPrice = BASE * mult * wiggle;
  const dexPrice = refPrice / (1 + spread / 100);
  return {
    pair,
    time: timeMs,
    dexPrice,
    refPrice,
    spreadPct: ((refPrice - dexPrice) / dexPrice) * 100,
    priceImpactPct: 0.08,
    liquidityUsd: 250_000,
    source: { dex: "replay", ref: "replay" },
  };
}
