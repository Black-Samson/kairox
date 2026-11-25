/**
 * Headless Kairox agent — the same signal model, risk engine and executor as the terminal, running
 * 24/7 without a browser (a VPS, Railway/Render worker, or `tmux` on your machine).
 *
 *   npm run agent                 # sandbox: simulated fills, prints decisions
 *   npm run agent -- --live       # live: trades through KairoxVault with AGENT_PRIVATE_KEY
 *
 * Config: AGENT_CONFIG='{"maxTradeUsd":25,"stopLossPct":1.5}' (merged over defaults, then clamped).
 * Decisions are appended to agent-journal.jsonl.
 */
import fs from "node:fs";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { PAIRS } = await import("@/config/pairs");
  const { vaultReady } = await import("@/config/contracts");
  const { clampConfigPatch, DEFAULT_CONFIG, evaluateExit, stopLossPrice, takeProfitPrice, validateEntry } = await import(
    "@/lib/agent/riskEngine"
  );
  const { computeSignal, describeSignal } = await import("@/lib/agent/signals");
  const { hashDecision } = await import("@/lib/agent/journal");
  const { getMarketTick } = await import("@/lib/market/tick");
  const { agentConfigured, executeVaultTrade } = await import("@/lib/chain/executor");
  type Tick = Awaited<ReturnType<typeof getMarketTick>>;
  type Pos = { pair: keyof typeof PAIRS; entry: number; size: number; cost: number; sl: number; tp: number };

  const live = process.argv.includes("--live");
  if (live && (!vaultReady || !agentConfigured())) {
    console.error("--live needs HSKSwap + vault addresses in .env.local and AGENT_PRIVATE_KEY.");
    process.exit(1);
  }

  const userCfg = process.env.AGENT_CONFIG ? JSON.parse(process.env.AGENT_CONFIG) : {};
  const { patch, notes } = clampConfigPatch(userCfg);
  const config = { ...DEFAULT_CONFIG, ...patch };
  notes.forEach((n) => console.warn(`config: ${n}`));

  const history: Record<string, Tick[]> = {};
  const positions: Pos[] = [];
  let cash = 1000;
  let realizedToday = 0;
  let day = Math.floor(Date.now() / 86_400_000);
  let lastEntryAt: number | undefined;

  const journal = (entry: Record<string, unknown>) => {
    const line = JSON.stringify({ time: new Date().toISOString(), mode: live ? "live" : "sandbox", ...entry });
    fs.appendFileSync("agent-journal.jsonl", `${line}\n`);
    console.log(line);
  };

  console.log(`Kairox agent — ${live ? "LIVE (vault)" : "sandbox"} — pairs ${config.pairs.join(", ")} — every ${config.scanIntervalSec}s`);

  const loop = async () => {
    const today = Math.floor(Date.now() / 86_400_000);
    if (today !== day) {
      day = today;
      realizedToday = 0;
    }
    for (const pair of config.pairs) {
      try {
        const tick = await getMarketTick(pair, config.maxTradeUsd);
        const h = (history[pair] = [...(history[pair] ?? []), tick].slice(-200));
        const signal = computeSignal(h, config);

        // Exits first.
        for (const p of positions.filter((x) => x.pair === pair)) {
          const reason = evaluateExit(
            { id: "", pair, openedAt: 0, entryPrice: p.entry, sizeBase: p.size, costUsd: p.cost, stopLossPrice: p.sl, takeProfitPrice: p.tp, markPrice: tick.dexPrice, unrealizedPnlUsd: 0, reasonHash: "" },
            tick.dexPrice,
            tick.spreadPct,
          );
          if (!reason) continue;
          const record = {
            pair, side: "SELL" as const, time: Date.now(), dexPrice: tick.dexPrice, refPrice: tick.refPrice, spreadPct: tick.spreadPct,
            momentumPct: signal.momentumPct, score: signal.score, reason,
            config: { maxTradeUsd: config.maxTradeUsd, stopLossPct: config.stopLossPct, takeProfitPct: config.takeProfitPct, maxSlippagePct: config.maxSlippagePct },
          };
          let proceeds = p.size * tick.dexPrice * 0.997;
          let tx: string | undefined;
          if (live) {
            const r = await executeVaultTrade({ pair: PAIRS[pair], side: "SELL", amount: "all", maxSlippagePct: config.maxSlippagePct, reasonHash: hashDecision(record), signalScoreBps: signal.score * 10_000 });
            proceeds = r.amountOut;
            tx = r.txHash;
          }
          cash += proceeds;
          realizedToday += proceeds - p.cost;
          positions.splice(positions.indexOf(p), 1);
          journal({ kind: "EXIT", pair, reason, pnl: +(proceeds - p.cost).toFixed(4), tx, reasonHash: hashDecision(record) });
        }

        if (positions.some((p) => p.pair === pair) || signal.direction !== "long") continue;
        const check = validateEntry({
          config, paused: false, realizedTodayUsd: realizedToday,
          openPositions: positions.map((p) => ({ id: "", pair: p.pair, openedAt: 0, entryPrice: p.entry, sizeBase: p.size, costUsd: p.cost, stopLossPrice: p.sl, takeProfitPrice: p.tp, markPrice: p.entry, unrealizedPnlUsd: 0, reasonHash: "" })),
          cashUsd: cash, proposedUsd: config.maxTradeUsd, expectedSlippagePct: tick.priceImpactPct ?? 0, pair, lastEntryAt, now: Date.now(),
        });
        if (!check.ok) {
          journal({ kind: "REJECTED", pair, failed: check.checks.filter((c) => !c.pass).map((c) => c.rule) });
          continue;
        }
        const record = {
          pair, side: "BUY" as const, time: Date.now(), dexPrice: tick.dexPrice, refPrice: tick.refPrice, spreadPct: tick.spreadPct,
          momentumPct: signal.momentumPct, score: signal.score, reason: describeSignal(signal),
          config: { maxTradeUsd: config.maxTradeUsd, stopLossPct: config.stopLossPct, takeProfitPct: config.takeProfitPct, maxSlippagePct: config.maxSlippagePct },
        };
        let entry = tick.dexPrice * 1.0005;
        let size = (check.sizeUsd * 0.997) / entry;
        let cost = check.sizeUsd;
        let tx: string | undefined;
        if (live) {
          const r = await executeVaultTrade({ pair: PAIRS[pair], side: "BUY", amount: check.sizeUsd.toFixed(2), maxSlippagePct: config.maxSlippagePct, reasonHash: hashDecision(record), signalScoreBps: signal.score * 10_000 });
          entry = r.price;
          size = r.amountOut;
          cost = r.amountIn;
          tx = r.txHash;
        }
        lastEntryAt = Date.now();
        cash -= cost;
        positions.push({ pair, entry, size, cost, sl: stopLossPrice(entry, config), tp: takeProfitPrice(entry, config) });
        journal({ kind: "ENTRY", pair, entry, size, cost, reason: record.reason, tx, reasonHash: hashDecision(record) });
      } catch (err) {
        journal({ kind: "ERROR", pair, error: (err as Error).message.split("\n")[0] });
      }
    }
  };

  await loop();
  setInterval(() => void loop(), config.scanIntervalSec * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
