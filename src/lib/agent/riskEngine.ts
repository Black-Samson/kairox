/**
 * Deterministic risk engine. No LLM is involved here: every proposed trade and every open position
 * is checked with plain arithmetic. The KairoxVault contract enforces the same core limits on-chain,
 * so this engine is the first filter and the vault is the backstop.
 */
import { isPairId, PAIR_IDS, type PairId } from "@/config/pairs";
import type { GuardrailCheck, Position, RiskConfig, ExitReason } from "./types";

/** Hard bounds no chat command, LLM output or slider can exceed. */
export const HARD_LIMITS = {
  maxTradeUsd: { min: 1, max: 500 },
  stopLossPct: { min: 0.2, max: 20 },
  takeProfitPct: { min: 0.2, max: 50 },
  maxSlippagePct: { min: 0.05, max: 5 }, // matches KairoxVault.MAX_SLIPPAGE_CAP_BPS
  scanIntervalSec: { min: 2, max: 300 },
  dailyLossLimitUsd: { min: 1, max: 1000 },
  entrySpreadPct: { min: 0.05, max: 10 },
  minSignalScore: { min: 0.1, max: 0.95 },
  maxOpenPositions: { min: 1, max: 5 },
} as const;

type NumericKey = keyof typeof HARD_LIMITS;

export const DEFAULT_CONFIG: RiskConfig = {
  maxTradeUsd: 50,
  stopLossPct: 2,
  takeProfitPct: 3,
  maxSlippagePct: 0.5,
  scanIntervalSec: 5,
  dailyLossLimitUsd: 25,
  entrySpreadPct: 0.4,
  minSignalScore: 0.55,
  maxOpenPositions: 2,
  pairs: ["HSK/USDT"],
};

export const RISK_PRESETS: Record<"conservative" | "balanced" | "aggressive", Partial<RiskConfig>> = {
  conservative: { maxTradeUsd: 25, stopLossPct: 1.5, takeProfitPct: 2, maxSlippagePct: 0.3, entrySpreadPct: 0.6, minSignalScore: 0.7, maxOpenPositions: 1 },
  balanced: { maxTradeUsd: 50, stopLossPct: 2, takeProfitPct: 3, maxSlippagePct: 0.5, entrySpreadPct: 0.4, minSignalScore: 0.55, maxOpenPositions: 2 },
  aggressive: { maxTradeUsd: 120, stopLossPct: 3.5, takeProfitPct: 6, maxSlippagePct: 1, entrySpreadPct: 0.25, minSignalScore: 0.4, maxOpenPositions: 3 },
};

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Clamp a (possibly hostile) partial config to HARD_LIMITS and an optional tighter ceiling
 * (e.g. the vault's on-chain maxTradeQuote). Returns the clean patch plus human-readable notes
 * for every value that had to be changed.
 */
export function clampConfigPatch(
  patch: Partial<Record<keyof RiskConfig, unknown>>,
  ceilings: Partial<Record<NumericKey, number>> = {},
): { patch: Partial<RiskConfig>; notes: string[] } {
  const out: Partial<RiskConfig> = {};
  const notes: string[] = [];

  for (const key of Object.keys(HARD_LIMITS) as NumericKey[]) {
    if (!(key in patch)) continue;
    const value = Number(patch[key]);
    if (!Number.isFinite(value)) {
      notes.push(`Ignored ${key}: not a number.`);
      continue;
    }
    const { min } = HARD_LIMITS[key];
    const max = Math.min(HARD_LIMITS[key].max, ceilings[key] ?? Infinity);
    let clamped = Math.min(Math.max(value, min), max);
    if (key === "maxOpenPositions" || key === "scanIntervalSec") clamped = Math.round(clamped);
    clamped = round(clamped);
    if (clamped !== value) {
      const why = value > max ? (ceilings[key] !== undefined && max === ceilings[key] ? "vault limit" : "hard limit") : "minimum";
      notes.push(`${key} ${value} → ${clamped} (${why})`);
    }
    (out as Record<string, number>)[key] = clamped;
  }

  if ("pairs" in patch && Array.isArray(patch.pairs)) {
    const pairs = patch.pairs.filter(isPairId) as PairId[];
    const dropped = (patch.pairs as unknown[]).filter((p) => !isPairId(p));
    if (dropped.length) notes.push(`Unsupported pairs ignored: ${dropped.join(", ")} (supported: ${PAIR_IDS.join(", ")})`);
    if (pairs.length) out.pairs = Array.from(new Set(pairs));
  }

  if (out.takeProfitPct !== undefined && out.stopLossPct !== undefined && out.takeProfitPct < out.stopLossPct * 0.5) {
    notes.push("Warning: take-profit is less than half the stop-loss — expected value is poor.");
  }
  return { patch: out, notes };
}

export interface EntryContext {
  config: RiskConfig;
  paused: boolean;
  realizedTodayUsd: number;
  openPositions: Position[];
  cashUsd: number;
  proposedUsd: number;
  expectedSlippagePct: number;
  pair: PairId;
  lastEntryAt?: number;
  now: number;
}

export interface EntryResult {
  ok: boolean;
  sizeUsd: number;
  checks: GuardrailCheck[];
}

/** Validate a proposed entry. Every rule is reported (pass or fail) for the decision log. */
export function validateEntry(ctx: EntryContext): EntryResult {
  const { config } = ctx;
  const sizeUsd = round(Math.min(ctx.proposedUsd, config.maxTradeUsd, ctx.cashUsd), 2);
  const exposure = ctx.openPositions.reduce((s, p) => s + p.costUsd, 0);
  const lossHalted = ctx.realizedTodayUsd <= -config.dailyLossLimitUsd;
  const minGapMs = config.scanIntervalSec * 1000;

  const checks: GuardrailCheck[] = [
    { rule: "Agent not paused", pass: !ctx.paused, detail: ctx.paused ? "kill-switch engaged" : "running" },
    {
      rule: "Daily loss limit",
      pass: !lossHalted,
      detail: `realized today ${ctx.realizedTodayUsd.toFixed(2)} / -${config.dailyLossLimitUsd} USDT`,
    },
    { rule: "Pair enabled", pass: config.pairs.includes(ctx.pair), detail: config.pairs.join(", ") || "none" },
    {
      rule: "Max open positions",
      pass: ctx.openPositions.length < config.maxOpenPositions,
      detail: `${ctx.openPositions.length} / ${config.maxOpenPositions}`,
    },
    {
      rule: "One position per pair",
      pass: !ctx.openPositions.some((p) => p.pair === ctx.pair),
      detail: ctx.openPositions.some((p) => p.pair === ctx.pair) ? "already in position" : "flat",
    },
    {
      rule: "Max trade size",
      pass: sizeUsd > 0 && sizeUsd <= config.maxTradeUsd,
      detail: `${sizeUsd.toFixed(2)} ≤ ${config.maxTradeUsd} USDT`,
    },
    { rule: "Sufficient balance", pass: ctx.cashUsd >= 1 && sizeUsd >= 1, detail: `${ctx.cashUsd.toFixed(2)} USDT free` },
    {
      rule: "Max slippage",
      pass: ctx.expectedSlippagePct <= config.maxSlippagePct,
      detail: `expected ${ctx.expectedSlippagePct.toFixed(3)}% ≤ ${config.maxSlippagePct}%`,
    },
    {
      rule: "Max exposure",
      pass: exposure + sizeUsd <= config.maxTradeUsd * config.maxOpenPositions,
      detail: `${(exposure + sizeUsd).toFixed(2)} ≤ ${(config.maxTradeUsd * config.maxOpenPositions).toFixed(2)} USDT`,
    },
    {
      rule: "Entry cooldown",
      pass: !ctx.lastEntryAt || ctx.now - ctx.lastEntryAt >= minGapMs,
      detail: ctx.lastEntryAt ? `${Math.round((ctx.now - ctx.lastEntryAt) / 1000)}s since last entry` : "first entry",
    },
  ];

  return { ok: checks.every((c) => c.pass), sizeUsd, checks };
}

export function stopLossPrice(entry: number, cfg: Pick<RiskConfig, "stopLossPct">) {
  return entry * (1 - cfg.stopLossPct / 100);
}
export function takeProfitPrice(entry: number, cfg: Pick<RiskConfig, "takeProfitPct">) {
  return entry * (1 + cfg.takeProfitPct / 100);
}

/** Evaluate an open position on every tick. Returns the exit reason, if any. */
export function evaluateExit(position: Position, markPrice: number, spreadPct: number): ExitReason | null {
  if (markPrice <= position.stopLossPrice) return "STOP_LOSS";
  if (markPrice >= position.takeProfitPrice) return "TAKE_PROFIT";
  // Mean-reversion exit: the DEX discount we bought has closed and we are in profit.
  if (spreadPct <= 0.02 && markPrice > position.entryPrice * 1.003) return "SPREAD_CONVERGED";
  return null;
}

/** minAmountOut for a swap, given an expected output and the slippage tolerance. */
export function minAmountOut(expectedOut: number, maxSlippagePct: number) {
  return expectedOut * (1 - maxSlippagePct / 100);
}
