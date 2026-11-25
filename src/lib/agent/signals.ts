/**
 * Signal model. Kairox trades spot only (long-only), so a "signal" means:
 * the HSKSwap price is at a discount to the external reference (spread), and short-term
 * momentum is not falling hard. This is spread / mean-reversion trading, not risk-free
 * arbitrage: we cannot trade the reference venue, we only bet the DEX price converges.
 */
import type { MarketTick, RiskConfig, SignalSnapshot } from "./types";

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function computeSignal(history: MarketTick[], config: RiskConfig): SignalSnapshot {
  const last = history[history.length - 1];
  if (!last) return { spreadPct: 0, momentumPct: 0, volatilityPct: 0, score: 0, direction: "none", notes: ["no data"] };

  const prices = history.slice(-60).map((t) => t.dexPrice);
  const fast = ema(prices.slice(-8), 8);
  const slow = ema(prices.slice(-30), 30);
  const momentumPct = slow ? ((fast - slow) / slow) * 100 : 0;
  const returns = prices.slice(1).map((p, i) => ((p - prices[i]) / prices[i]) * 100);
  const volatilityPct = stdev(returns.slice(-30));
  const spreadPct = last.spreadPct;

  const notes: string[] = [];
  // Spread component: 0 at half the threshold, 1 at 2x threshold.
  const spreadScore = clamp01((spreadPct - config.entrySpreadPct * 0.5) / (config.entrySpreadPct * 1.5));
  // Momentum component: penalise falling knives, mildly reward upward drift.
  const momentumScore = clamp01(0.5 + momentumPct / 1.0);
  // Volatility component: very high volatility makes the spread less trustworthy.
  const volScore = clamp01(1 - volatilityPct / 1.5);
  const score = Math.round((0.6 * spreadScore + 0.25 * momentumScore + 0.15 * volScore) * 1000) / 1000;

  if (spreadPct >= config.entrySpreadPct) notes.push(`DEX discount ${spreadPct.toFixed(3)}% ≥ ${config.entrySpreadPct}% threshold`);
  else if (spreadPct > 0) notes.push(`DEX discount ${spreadPct.toFixed(3)}% below ${config.entrySpreadPct}% threshold`);
  else notes.push(`DEX premium ${Math.abs(spreadPct).toFixed(3)}% — spot is long-only, no short`);
  if (momentumPct < -0.3) notes.push(`momentum falling (${momentumPct.toFixed(2)}%)`);
  else if (momentumPct > 0.1) notes.push(`momentum rising (+${momentumPct.toFixed(2)}%)`);
  if (volatilityPct > 1) notes.push(`high volatility (${volatilityPct.toFixed(2)}%)`);
  if (last.priceImpactPct !== undefined) notes.push(`est. impact ${last.priceImpactPct.toFixed(3)}%`);

  const direction = spreadPct >= config.entrySpreadPct && score >= config.minSignalScore && momentumPct > -0.5 ? "long" : "none";
  return { spreadPct, momentumPct, volatilityPct, score, direction, notes };
}

export function describeSignal(sig: SignalSnapshot): string {
  return `score ${(sig.score * 100).toFixed(0)}/100 · ${sig.notes.join(" · ")}`;
}
