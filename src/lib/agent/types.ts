import type { PairId } from "@/config/pairs";

/** User-tunable agent configuration. Every field is clamped to HARD_LIMITS before use. */
export interface RiskConfig {
  maxTradeUsd: number; // quote spent per entry
  stopLossPct: number; // % below entry
  takeProfitPct: number; // % above entry
  maxSlippagePct: number; // max price impact / slippage accepted
  scanIntervalSec: number; // seconds between market scans
  dailyLossLimitUsd: number; // realized loss per UTC day before entries halt
  entrySpreadPct: number; // reference premium over DEX needed to enter
  minSignalScore: number; // 0..1 combined signal needed to enter
  maxOpenPositions: number;
  pairs: PairId[]; // target assets the agent may trade
}

export type AgentStatus = "SCANNING" | "IN_POSITION" | "PAUSED" | "HALTED";
export type ExecutionMode = "sandbox" | "live";
export type DataSource = "live" | "replay";

export interface Candle {
  time: number; // unix seconds, bucket start
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number; // base-token volume (HSK) for the bucket, when the source provides it
}

export interface MarketTick {
  pair: PairId;
  time: number; // unix ms
  dexPrice: number; // HSKSwap price (quote per base)
  refPrice: number; // external spot reference
  spreadPct: number; // (ref - dex) / dex * 100 ; positive = DEX is cheap
  liquidityUsd?: number;
  priceImpactPct?: number; // estimated impact for maxTradeUsd
  change24hPct?: number; // reference market 24h change, %
  volume24h?: number; // reference market 24h volume, in HSK
  source: {
    dex: "hskswap" | "simulated" | "replay";
    ref: string; // e.g. "gate", "mexc", "coingecko", "synthetic", "replay"
  };
}

export interface SignalSnapshot {
  spreadPct: number;
  momentumPct: number; // fast EMA vs slow EMA, %
  volatilityPct: number; // recent stdev of returns, %
  score: number; // 0..1
  direction: "long" | "none";
  notes: string[];
}

export interface GuardrailCheck {
  rule: string;
  pass: boolean;
  detail: string;
}

export interface Position {
  id: string;
  pair: PairId;
  openedAt: number;
  entryPrice: number;
  sizeBase: number;
  costUsd: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  markPrice: number;
  unrealizedPnlUsd: number;
  entryTx?: string;
  reasonHash: string;
}

export interface ClosedTrade {
  id: string;
  pair: PairId;
  openedAt: number;
  closedAt: number;
  entryPrice: number;
  exitPrice: number;
  sizeBase: number;
  costUsd: number;
  proceedsUsd: number;
  realizedPnlUsd: number;
  feesUsd: number;
  exitReason: ExitReason;
  exitTx?: string;
}

export type ExitReason = "STOP_LOSS" | "TAKE_PROFIT" | "SPREAD_CONVERGED" | "MANUAL" | "EMERGENCY";

export type DecisionKind = "ENTRY" | "EXIT" | "SKIP" | "REJECTED" | "INFO";

export interface DecisionLog {
  id: string;
  time: number;
  pair: PairId;
  kind: DecisionKind;
  summary: string; // plain-English reasoning
  signal?: SignalSnapshot;
  checks?: GuardrailCheck[];
  reasonHash?: string;
}

export interface Receipt {
  id: string;
  time: number;
  pair: PairId;
  side: "BUY" | "SELL";
  amountIn: number;
  amountOut: number;
  price: number;
  txHash?: string; // undefined for sandbox fills
  simulated: boolean;
  reasonHash: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  time: number;
  changes?: string[];
}

/** Record that is hashed into the on-chain decision journal (vault TradeExecuted.reasonHash). */
export interface DecisionRecord {
  pair: PairId;
  side: "BUY" | "SELL";
  time: number;
  dexPrice: number;
  refPrice: number;
  spreadPct: number;
  momentumPct: number;
  score: number;
  reason: string;
  config: Pick<RiskConfig, "maxTradeUsd" | "stopLossPct" | "takeProfitPct" | "maxSlippagePct">;
}
