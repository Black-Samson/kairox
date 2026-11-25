"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Address } from "viem";
import { PAIRS, type PairId } from "@/config/pairs";
import { computeSignal, describeSignal } from "@/lib/agent/signals";
import {
  DEFAULT_CONFIG,
  evaluateExit,
  stopLossPrice,
  takeProfitPrice,
  validateEntry,
} from "@/lib/agent/riskEngine";
import { hashDecision } from "@/lib/agent/journal";
import type { AgentSnapshot, CopilotResult } from "@/lib/agent/copilot";
import type {
  AgentStatus,
  Candle,
  ChatMessage,
  ClosedTrade,
  DataSource,
  DecisionLog,
  DecisionRecord,
  ExecutionMode,
  ExitReason,
  MarketTick,
  Position,
  Receipt,
  RiskConfig,
  SignalSnapshot,
} from "@/lib/agent/types";
import type { OwnerSession } from "@/lib/chain/session";
import { REPLAY_LENGTH, replayTick } from "@/lib/market/replay";
import type { VaultStatus } from "@/lib/chain/executor";

export const SANDBOX_START_USD = 1000;
const SANDBOX_FEE = 0.003; // 0.3% pool fee
const MAX_TICKS = 400;
const MAX_LOGS = 300;

export interface SessionInfo {
  kind: "none" | "sandbox" | "privy" | "wallet";
  method?: "google" | "twitter" | "email" | "passkey" | "wallet" | "sandbox";
  label?: string;
  address?: Address;
}

export interface ServerStatus {
  network: "mainnet" | "testnet";
  chainId: number;
  hskswapVersion: "v2" | "v3";
  marketMode: "onchain" | "reference";
  liveAvailable: boolean;
  agentAddress: Address | null;
  llm: boolean;
  issues: string[];
  vault: VaultStatus | null;
  vaultError?: string;
}

interface AgentState {
  session: SessionInfo;
  authOpen: boolean;
  serverStatus?: ServerStatus;
  executionMode: ExecutionMode;
  ownerSession?: OwnerSession;
  dataSource: DataSource;
  replayStep: number;
  pair: PairId;
  config: RiskConfig;
  paused: boolean;
  busy: boolean;
  warning?: string;

  ticks: Record<PairId, MarketTick[]>;
  candles: Record<PairId, Candle[]>;
  candleSource: string;
  candleIntervalSec: number;
  signals: Partial<Record<PairId, SignalSnapshot>>;

  cashUsd: number;
  positions: Position[];
  closed: ClosedTrade[];
  logs: DecisionLog[];
  receipts: Receipt[];
  chat: ChatMessage[];
  chatBusy: boolean;
  lastEntryAt?: number;
  equityCurve: { time: number; equity: number }[];

  // actions
  setAuthOpen: (open: boolean) => void;
  setSession: (s: SessionInfo) => void;
  startSandbox: () => void;
  signOut: () => void;
  setServerStatus: (s: ServerStatus) => void;
  enableLive: (session: OwnerSession) => void;
  disableLive: () => void;
  setPair: (p: PairId) => void;
  setDataSource: (d: DataSource) => void;
  setConfig: (patch: Partial<RiskConfig>) => void;
  setPaused: (paused: boolean) => void;
  loadHistory: (pair: PairId) => Promise<void>;
  tick: () => Promise<void>;
  closePosition: (id: string, reason: ExitReason) => Promise<void>;
  emergencyClose: () => Promise<void>;
  sendChat: (text: string) => Promise<void>;
  resetSandbox: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const emptyByPair = <T,>(v: () => T) => Object.fromEntries(Object.keys(PAIRS).map((k) => [k, v()])) as Record<PairId, T>;
const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

export function realizedToday(closed: ClosedTrade[], now = Date.now()) {
  const d = utcDay(now);
  return closed.filter((c) => utcDay(c.closedAt) === d).reduce((s, c) => s + c.realizedPnlUsd, 0);
}

export function computeStats(closed: ClosedTrade[], curve: { equity: number }[]) {
  const wins = closed.filter((c) => c.realizedPnlUsd > 0).length;
  let peak = -Infinity;
  let maxDd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    maxDd = Math.max(maxDd, peak - p.equity);
  }
  return {
    trades: closed.length,
    winRate: closed.length ? wins / closed.length : 0,
    realized: closed.reduce((s, c) => s + c.realizedPnlUsd, 0),
    fees: closed.reduce((s, c) => s + c.feesUsd, 0),
    maxDrawdownUsd: maxDd,
    avgWin: wins ? closed.filter((c) => c.realizedPnlUsd > 0).reduce((s, c) => s + c.realizedPnlUsd, 0) / wins : 0,
    avgLoss:
      closed.length - wins
        ? closed.filter((c) => c.realizedPnlUsd <= 0).reduce((s, c) => s + c.realizedPnlUsd, 0) / (closed.length - wins)
        : 0,
  };
}

export function agentStatus(s: Pick<AgentState, "paused" | "positions" | "closed" | "config">): AgentStatus {
  if (s.paused) return "PAUSED";
  if (realizedToday(s.closed) <= -s.config.dailyLossLimitUsd) return "HALTED";
  return s.positions.length ? "IN_POSITION" : "SCANNING";
}

export function buildSnapshot(s: AgentState): AgentSnapshot {
  const last = s.ticks[s.pair].at(-1);
  const unrealized = s.positions.reduce((a, p) => a + p.unrealizedPnlUsd, 0);
  const stats = computeStats(s.closed, s.equityCurve);
  const lastDecision = s.logs.find((l) => l.kind !== "INFO");
  return {
    status: agentStatus(s),
    mode: s.executionMode,
    pair: s.pair,
    dexPrice: last?.dexPrice,
    refPrice: last?.refPrice,
    spreadPct: last?.spreadPct,
    cashUsd: s.cashUsd,
    equityUsd: s.cashUsd + s.positions.reduce((a, p) => a + p.sizeBase * p.markPrice, 0),
    realizedTodayUsd: realizedToday(s.closed),
    unrealizedUsd: unrealized,
    positions: s.positions.map((p) => ({
      pair: p.pair,
      entry: p.entryPrice,
      mark: p.markPrice,
      sizeBase: p.sizeBase,
      pnlUsd: p.unrealizedPnlUsd,
      sl: p.stopLossPrice,
      tp: p.takeProfitPrice,
    })),
    lastDecision: lastDecision ? `[${lastDecision.kind}] ${lastDecision.summary}` : undefined,
    stats: { trades: stats.trades, winRate: stats.winRate, maxDrawdownUsd: stats.maxDrawdownUsd },
  };
}

function mergeCandle(candles: Candle[], price: number, timeMs: number, interval: number): Candle[] {
  const bucket = Math.floor(timeMs / 1000 / interval) * interval;
  const last = candles.at(-1);
  if (last && last.time === bucket) {
    const updated = { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
    return [...candles.slice(0, -1), updated];
  }
  if (last && bucket < last.time) return candles;
  const open = last ? last.close : price;
  return [...candles, { time: bucket, open, close: price, high: Math.max(open, price), low: Math.min(open, price) }].slice(-500);
}

async function executeLive(
  get: () => AgentState,
  side: "BUY" | "SELL",
  amount: string,
  record: DecisionRecord,
): Promise<{ txHash: string; amountIn: number; amountOut: number; price: number; realizedPnl: number }> {
  const s = get();
  const res = await fetch("/api/agent/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session: s.ownerSession, side, amount, maxSlippagePct: s.config.maxSlippagePct, record }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "execution failed");
  return data;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => {
      const log = (entry: Omit<DecisionLog, "id" | "time"> & { time?: number }) =>
        set((s) => ({ logs: [{ id: uid(), time: entry.time ?? Date.now(), ...entry }, ...s.logs].slice(0, MAX_LOGS) }));

      const agentSay = (text: string, changes?: string[]) =>
        set((s) => ({ chat: [...s.chat, { id: uid(), role: "agent" as const, text, time: Date.now(), changes }].slice(-100) }));

      async function exitPosition(position: Position, reason: ExitReason, tick?: MarketTick) {
        const s = get();
        const mark = tick?.dexPrice ?? position.markPrice;
        const record: DecisionRecord = {
          pair: position.pair,
          side: "SELL",
          time: Date.now(),
          dexPrice: mark,
          refPrice: tick?.refPrice ?? mark,
          spreadPct: tick?.spreadPct ?? 0,
          momentumPct: s.signals[position.pair]?.momentumPct ?? 0,
          score: s.signals[position.pair]?.score ?? 0,
          reason: `${reason}: mark ${mark.toFixed(5)} vs entry ${position.entryPrice.toFixed(5)} (SL ${position.stopLossPrice.toFixed(5)}, TP ${position.takeProfitPrice.toFixed(5)})`,
          config: {
            maxTradeUsd: s.config.maxTradeUsd,
            stopLossPct: s.config.stopLossPct,
            takeProfitPct: s.config.takeProfitPct,
            maxSlippagePct: s.config.maxSlippagePct,
          },
        };
        const reasonHash = hashDecision(record);

        let exitPrice: number;
        let proceeds: number;
        let fees: number;
        let txHash: string | undefined;
        try {
          if (s.executionMode === "live") {
            const r = await executeLive(get, "SELL", "all", record);
            exitPrice = r.price;
            proceeds = r.amountOut;
            fees = position.costUsd * SANDBOX_FEE; // pool fee estimate; real fee is inside the swap price
            txHash = r.txHash;
          } else {
            const impact = (tick?.priceImpactPct ?? 0.1) / 100;
            exitPrice = mark * (1 - impact * 0.5);
            const gross = position.sizeBase * exitPrice;
            fees = gross * SANDBOX_FEE;
            proceeds = gross - fees;
          }
        } catch (err) {
          log({ pair: position.pair, kind: "REJECTED", summary: `Exit (${reason}) failed: ${(err as Error).message}`, reasonHash });
          return;
        }

        const realized = proceeds - position.costUsd;
        const trade: ClosedTrade = {
          id: position.id,
          pair: position.pair,
          openedAt: position.openedAt,
          closedAt: Date.now(),
          entryPrice: position.entryPrice,
          exitPrice,
          sizeBase: position.sizeBase,
          costUsd: position.costUsd,
          proceedsUsd: proceeds,
          realizedPnlUsd: realized,
          feesUsd: fees,
          exitReason: reason,
          exitTx: txHash,
        };
        set((st) => ({
          positions: st.positions.filter((p) => p.id !== position.id),
          closed: [trade, ...st.closed].slice(0, 500),
          cashUsd: st.cashUsd + proceeds,
          receipts: [
            {
              id: uid(),
              time: Date.now(),
              pair: position.pair,
              side: "SELL" as const,
              amountIn: position.sizeBase,
              amountOut: proceeds,
              price: exitPrice,
              txHash,
              simulated: !txHash,
              reasonHash,
            },
            ...st.receipts,
          ].slice(0, 300),
        }));
        const label = { STOP_LOSS: "Stop-loss hit", TAKE_PROFIT: "Take-profit hit", SPREAD_CONVERGED: "Spread converged", MANUAL: "Closed manually", EMERGENCY: "Emergency close" }[reason];
        log({
          pair: position.pair,
          kind: "EXIT",
          summary: `${label}: sold ${position.sizeBase.toFixed(2)} ${PAIRS[position.pair].base.symbol} @ ${exitPrice.toFixed(5)} → ${realized >= 0 ? "+" : ""}${realized.toFixed(2)} USDT`,
          reasonHash,
        });
        const st = get();
        if (realizedToday(st.closed) <= -st.config.dailyLossLimitUsd) {
          log({ pair: position.pair, kind: "INFO", summary: `Daily loss limit reached (${realizedToday(st.closed).toFixed(2)} USDT). New entries halted until 00:00 UTC; exits still run.` });
        }
      }

      async function tryEntry(pair: PairId, tick: MarketTick, signal: SignalSnapshot) {
        const s = get();
        const check = validateEntry({
          config: s.config,
          paused: s.paused,
          realizedTodayUsd: realizedToday(s.closed),
          openPositions: s.positions,
          cashUsd: s.cashUsd,
          proposedUsd: s.config.maxTradeUsd,
          expectedSlippagePct: tick.priceImpactPct ?? 0,
          pair,
          lastEntryAt: s.lastEntryAt,
          now: Date.now(),
        });
        const reason = `Buy ${pair}: ${describeSignal(signal)}`;
        if (!check.ok) {
          const failed = check.checks.filter((c) => !c.pass).map((c) => c.rule);
          log({ pair, kind: "REJECTED", summary: `Signal OK but guardrails blocked entry: ${failed.join(", ")}`, signal, checks: check.checks });
          return;
        }
        const record: DecisionRecord = {
          pair,
          side: "BUY",
          time: Date.now(),
          dexPrice: tick.dexPrice,
          refPrice: tick.refPrice,
          spreadPct: tick.spreadPct,
          momentumPct: signal.momentumPct,
          score: signal.score,
          reason,
          config: {
            maxTradeUsd: s.config.maxTradeUsd,
            stopLossPct: s.config.stopLossPct,
            takeProfitPct: s.config.takeProfitPct,
            maxSlippagePct: s.config.maxSlippagePct,
          },
        };
        const reasonHash = hashDecision(record);
        set({ lastEntryAt: Date.now() });

        let entryPrice: number;
        let sizeBase: number;
        let cost = check.sizeUsd;
        let txHash: string | undefined;
        try {
          if (s.executionMode === "live") {
            const r = await executeLive(get, "BUY", check.sizeUsd.toFixed(2), record);
            entryPrice = r.price;
            sizeBase = r.amountOut;
            cost = r.amountIn;
            txHash = r.txHash;
          } else {
            const impact = (tick.priceImpactPct ?? 0.1) / 100;
            const noise = Math.random() * 0.25 * (s.config.maxSlippagePct / 100);
            entryPrice = tick.dexPrice * (1 + impact * 0.5 + noise);
            sizeBase = (cost * (1 - SANDBOX_FEE)) / entryPrice;
          }
        } catch (err) {
          log({ pair, kind: "REJECTED", summary: `Entry failed on-chain: ${(err as Error).message}`, signal, checks: check.checks, reasonHash });
          return;
        }

        const position: Position = {
          id: uid(),
          pair,
          openedAt: Date.now(),
          entryPrice,
          sizeBase,
          costUsd: cost,
          stopLossPrice: stopLossPrice(entryPrice, s.config),
          takeProfitPrice: takeProfitPrice(entryPrice, s.config),
          markPrice: tick.dexPrice,
          unrealizedPnlUsd: sizeBase * tick.dexPrice - cost,
          entryTx: txHash,
          reasonHash,
        };
        set((st) => ({
          positions: [...st.positions, position],
          cashUsd: st.cashUsd - cost,
          receipts: [
            { id: uid(), time: Date.now(), pair, side: "BUY" as const, amountIn: cost, amountOut: sizeBase, price: entryPrice, txHash, simulated: !txHash, reasonHash },
            ...st.receipts,
          ].slice(0, 300),
        }));
        log({
          pair,
          kind: "ENTRY",
          summary: `Bought ${sizeBase.toFixed(2)} ${PAIRS[pair].base.symbol} for ${cost.toFixed(2)} USDT @ ${entryPrice.toFixed(5)}. HSKSwap is ${tick.spreadPct.toFixed(2)}% below reference; SL ${position.stopLossPrice.toFixed(5)}, TP ${position.takeProfitPrice.toFixed(5)}.`,
          signal,
          checks: check.checks,
          reasonHash,
        });
      }

      return {
        session: { kind: "none" },
        authOpen: false,
        executionMode: "sandbox",
        dataSource: "live",
        replayStep: 0,
        pair: "HSK/USDT",
        config: DEFAULT_CONFIG,
        paused: false,
        busy: false,
        ticks: emptyByPair<MarketTick[]>(() => []),
        candles: emptyByPair<Candle[]>(() => []),
        candleSource: "",
        candleIntervalSec: 60,
        signals: {},
        cashUsd: SANDBOX_START_USD,
        positions: [],
        closed: [],
        logs: [],
        receipts: [],
        chat: [
          {
            id: "hello",
            role: "agent",
            time: 0,
            text: 'I\'m your Kairox copilot. Try: "Set stop-loss to 2%, max trade 50 USDT, and buy HSK/USDT when spread exceeds 0.4%" — or ask "how are we doing?"',
          },
        ],
        chatBusy: false,
        equityCurve: [],

        setAuthOpen: (authOpen) => set({ authOpen }),
        setSession: (session) => set({ session }),
        startSandbox: () => {
          set({ session: { kind: "sandbox", method: "sandbox", label: "Judge Sandbox" }, authOpen: false, executionMode: "sandbox" });
          get().resetSandbox();
          log({ pair: get().pair, kind: "INFO", summary: `Judge Sandbox started with ${SANDBOX_START_USD} simulated USDT. No wallet or gas needed.` });
        },
        signOut: () => set({ session: { kind: "none" }, executionMode: "sandbox", ownerSession: undefined }),
        setServerStatus: (serverStatus) => set({ serverStatus }),
        enableLive: (ownerSession) => {
          const vault = get().serverStatus?.vault;
          set({ ownerSession, executionMode: "live", cashUsd: vault?.quoteBalance ?? 0, positions: [], equityCurve: [] });
          log({ pair: get().pair, kind: "INFO", summary: "Live trading enabled — the agent now trades through your KairoxVault on HashKey Chain." });
        },
        disableLive: () => {
          set({ executionMode: "sandbox", ownerSession: undefined });
          get().resetSandbox();
        },
        setPair: (pair) => {
          set({ pair });
          if (!get().candles[pair].length) void get().loadHistory(pair);
        },
        setDataSource: (dataSource) => {
          set({
            dataSource,
            replayStep: 0,
            ticks: emptyByPair<MarketTick[]>(() => []),
            candles: emptyByPair<Candle[]>(() => []),
            candleIntervalSec: dataSource === "replay" ? 5 : 60,
          });
          if (dataSource === "replay" && get().executionMode === "live") set({ executionMode: "sandbox" });
          void get().loadHistory(get().pair);
          log({
            pair: get().pair,
            kind: "INFO",
            summary:
              dataSource === "replay"
                ? "Replay mode: a scripted 3-minute market that triggers take-profit, stop-loss, a skipped premium and a convergence exit. Sandbox fills only."
                : "Live market data.",
          });
        },
        setConfig: (patch) => {
          set((s) => ({ config: { ...s.config, ...patch } }));
          // Re-price stops for open positions when SL/TP change.
          if (patch.stopLossPct !== undefined || patch.takeProfitPct !== undefined) {
            const cfg = get().config;
            set((s) => ({
              positions: s.positions.map((p) => ({
                ...p,
                stopLossPrice: stopLossPrice(p.entryPrice, cfg),
                takeProfitPrice: takeProfitPrice(p.entryPrice, cfg),
              })),
            }));
          }
        },
        setPaused: (paused) => {
          set({ paused });
          log({ pair: get().pair, kind: "INFO", summary: paused ? "Agent paused (kill-switch): no new entries. Stop-loss / take-profit protection stays on for open positions." : "Agent resumed." });
        },

        loadHistory: async (pair) => {
          const s = get();
          if (s.dataSource === "replay") {
            const now = Date.now();
            const candles: Candle[] = [];
            let c: Candle[] = [];
            for (let i = 0; i < 120; i++) {
              const t = replayTick(pair, 0, now - (120 - i) * 1000);
              const jitter = 1 + 0.0015 * Math.sin(i * 0.9) + 0.001 * Math.sin(i * 2.3);
              c = mergeCandle(c, t.dexPrice * jitter, now - (120 - i) * 5000, 5);
            }
            candles.push(...c);
            set((st) => ({ candles: { ...st.candles, [pair]: candles }, candleSource: "replay" }));
            return;
          }
          try {
            const res = await fetch(`/api/market/history?pair=${encodeURIComponent(pair)}`);
            const data = (await res.json()) as { candles: Candle[]; source: string };
            set((st) => ({ candles: { ...st.candles, [pair]: data.candles }, candleSource: data.source }));
          } catch {
            /* chart will build from ticks */
          }
        },

        tick: async () => {
          const s = get();
          if (s.busy || s.session.kind === "none") return;
          set({ busy: true });
          try {
            const pairs: PairId[] =
              s.dataSource === "replay" ? [s.pair] : Array.from(new Set<PairId>([s.pair, ...s.config.pairs]));
            const now = Date.now();
            const ticks: MarketTick[] = [];
            let warning: string | undefined;
            if (s.dataSource === "replay") {
              ticks.push(replayTick(s.pair, s.replayStep, now));
              set({ replayStep: (s.replayStep + 1) % REPLAY_LENGTH });
            } else {
              const results = await Promise.allSettled(
                pairs.map(async (p) => {
                  const r = await fetch(`/api/market/tick?pair=${encodeURIComponent(p)}&tradeUsd=${s.config.maxTradeUsd}`);
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error);
                  return d as MarketTick & { warning?: string };
                }),
              );
              for (const r of results) {
                if (r.status === "fulfilled") {
                  ticks.push(r.value);
                  if (r.value.warning) warning = r.value.warning;
                } else warning = `Market feed error: ${(r.reason as Error).message}`;
              }
            }
            set({ warning });

            for (const tick of ticks) {
              const pair = tick.pair;
              set((st) => ({
                ticks: { ...st.ticks, [pair]: [...st.ticks[pair], tick].slice(-MAX_TICKS) },
                candles: { ...st.candles, [pair]: mergeCandle(st.candles[pair], tick.dexPrice, tick.time, st.candleIntervalSec) },
              }));
              const st = get();
              const signal = computeSignal(st.ticks[pair], st.config);
              set((x) => ({ signals: { ...x.signals, [pair]: signal } }));

              // 1. Mark & manage open positions. Stop-loss / take-profit protection keeps running even
              //    while paused — pausing only stops NEW entries. Emergency Close flattens everything.
              for (const p of st.positions.filter((p) => p.pair === pair)) {
                const marked = { ...p, markPrice: tick.dexPrice, unrealizedPnlUsd: p.sizeBase * tick.dexPrice * (1 - SANDBOX_FEE) - p.costUsd };
                set((x) => ({ positions: x.positions.map((q) => (q.id === p.id ? marked : q)) }));
                const reason = evaluateExit(marked, tick.dexPrice, tick.spreadPct);
                if (reason) await exitPosition(marked, reason, tick);
              }

              // 2. Look for entries.
              const cur = get();
              if (cur.paused || !cur.config.pairs.includes(pair)) continue;
              if (signal.direction === "long") {
                await tryEntry(pair, tick, signal);
              } else if (signal.spreadPct >= cur.config.entrySpreadPct * 0.75 || signal.spreadPct <= -cur.config.entrySpreadPct) {
                // Log near-misses and premiums so judges can see the agent "thinking", without spamming.
                const lastLog = cur.logs.find((l) => l.pair === pair && l.kind === "SKIP");
                if (!lastLog || Date.now() - lastLog.time > 8000) {
                  log({ pair, kind: "SKIP", summary: `No entry: ${describeSignal(signal)}`, signal });
                }
              }
            }

            const after = get();
            const equity =
              after.cashUsd + after.positions.reduce((a, p) => a + p.sizeBase * p.markPrice * (1 - SANDBOX_FEE), 0);
            set({ equityCurve: [...after.equityCurve, { time: Date.now(), equity }].slice(-2000) });
          } finally {
            set({ busy: false });
          }
        },

        closePosition: async (id, reason) => {
          const p = get().positions.find((x) => x.id === id);
          if (!p) return;
          await exitPosition(p, reason, get().ticks[p.pair].at(-1));
        },

        emergencyClose: async () => {
          set({ paused: true });
          log({ pair: get().pair, kind: "INFO", summary: "EMERGENCY CLOSE: agent paused, closing all positions at market." });
          for (const p of [...get().positions]) {
            await exitPosition(p, "EMERGENCY", get().ticks[p.pair].at(-1));
          }
        },

        sendChat: async (text) => {
          const userMsg: ChatMessage = { id: uid(), role: "user", text, time: Date.now() };
          set((s) => ({ chat: [...s.chat, userMsg].slice(-100), chatBusy: true }));
          try {
            const s = get();
            const res = await fetch("/api/agent/chat", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ message: text, config: s.config, snapshot: buildSnapshot(s), live: s.executionMode === "live" }),
            });
            const data = (await res.json()) as CopilotResult & { error?: string };
            if (!res.ok) throw new Error(data.error ?? "copilot error");

            const changes: string[] = [];
            const before = get().config;
            for (const [k, v] of Object.entries(data.patch)) {
              const prev = before[k as keyof RiskConfig];
              if (JSON.stringify(prev) !== JSON.stringify(v)) {
                changes.push(`${k}: ${Array.isArray(prev) ? prev.join(", ") : prev} → ${Array.isArray(v) ? v.join(", ") : v}`);
              }
            }
            if (Object.keys(data.patch).length) get().setConfig(data.patch);
            if (data.action === "pause") get().setPaused(true);
            if (data.action === "resume") get().setPaused(false);
            if (data.action === "close_all") await get().emergencyClose();
            if (data.action) changes.push(`action: ${data.action}`);

            const notes = data.notes.length ? `\n⚠ ${data.notes.join("\n⚠ ")}` : "";
            agentSay(`${data.reply}${notes}`, changes);
          } catch (err) {
            agentSay(`Sorry — ${(err as Error).message}`);
          } finally {
            set({ chatBusy: false });
          }
        },

        resetSandbox: () =>
          set({
            cashUsd: SANDBOX_START_USD,
            positions: [],
            closed: [],
            receipts: [],
            logs: [],
            equityCurve: [],
            lastEntryAt: undefined,
            paused: false,
          }),
      };
    },
    {
      name: "kairox-agent",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ config: s.config, pair: s.pair }),
    },
  ),
);
