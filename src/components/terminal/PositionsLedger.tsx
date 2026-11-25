"use client";

import { useState } from "react";
import { explorerTx } from "@/config/chains";
import { fmtPrice, fmtSigned, fmtTime, pnlClass, shortAddr } from "@/lib/format";
import type { DecisionLog } from "@/lib/agent/types";
import { useAgentStore } from "@/store/agentStore";
import { VaultPanel } from "./VaultPanel";

type Tab = "positions" | "logs" | "receipts" | "vault";

const KIND_STYLE: Record<DecisionLog["kind"], string> = {
  ENTRY: "bg-cyan/15 text-cyan",
  EXIT: "bg-emerald/15 text-emerald",
  SKIP: "bg-white/5 text-white/50",
  REJECTED: "bg-crimson/15 text-crimson",
  INFO: "bg-violet-400/15 text-violet-300",
};

function Positions() {
  const positions = useAgentStore((s) => s.positions);
  const closed = useAgentStore((s) => s.closed);
  const closePosition = useAgentStore((s) => s.closePosition);

  return (
    <div className="space-y-4">
      <table className="w-full text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-white/35">
          <tr>
            <th className="py-1.5 font-medium">Pair</th>
            <th className="font-medium">Size</th>
            <th className="font-medium">Entry</th>
            <th className="font-medium">Mark</th>
            <th className="font-medium">Stop-loss</th>
            <th className="font-medium">Take-profit</th>
            <th className="font-medium">Unrealized</th>
            <th />
          </tr>
        </thead>
        <tbody className="num">
          {positions.length === 0 && (
            <tr>
              <td colSpan={8} className="py-6 text-center font-sans text-white/35">
                No open positions — scanning HSKSwap for a discount to the reference price.
              </td>
            </tr>
          )}
          {positions.map((p) => {
            const pct = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100;
            return (
              <tr key={p.id} className="border-t border-white/5">
                <td className="py-2 font-sans font-semibold text-white">{p.pair}</td>
                <td>{p.sizeBase.toFixed(2)}</td>
                <td className="text-cyan">{fmtPrice(p.entryPrice)}</td>
                <td>{fmtPrice(p.markPrice)}</td>
                <td className="text-crimson">{fmtPrice(p.stopLossPrice)}</td>
                <td className="text-emerald">{fmtPrice(p.takeProfitPrice)}</td>
                <td className={pnlClass(p.unrealizedPnlUsd)}>
                  {fmtSigned(p.unrealizedPnlUsd)} <span className="text-white/35">({fmtSigned(pct)}%)</span>
                </td>
                <td className="text-right">
                  <button onClick={() => void closePosition(p.id, "MANUAL")} className="rounded-md border border-white/15 px-2 py-1 font-sans text-[11px] text-white/70 hover:border-crimson/50 hover:text-crimson">
                    Close
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {closed.length > 0 && (
        <div>
          <p className="card-title mb-1">Closed trades</p>
          <table className="w-full text-left text-xs">
            <tbody className="num">
              {closed.slice(0, 20).map((c) => (
                <tr key={c.id} className="border-t border-white/5 text-white/70">
                  <td className="py-1.5 font-sans">{fmtTime(c.closedAt)}</td>
                  <td className="font-sans">{c.pair}</td>
                  <td>
                    {fmtPrice(c.entryPrice)} → {fmtPrice(c.exitPrice)}
                  </td>
                  <td className="font-sans text-[10px] uppercase text-white/45">{c.exitReason.replace("_", " ")}</td>
                  <td className={`text-right ${pnlClass(c.realizedPnlUsd)}`}>{fmtSigned(c.realizedPnlUsd)} USDT</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Logs() {
  const logs = useAgentStore((s) => s.logs);
  const [open, setOpen] = useState<string | null>(null);
  if (!logs.length) return <p className="py-6 text-center text-xs text-white/35">The agent&apos;s reasoning will appear here on every decision.</p>;
  return (
    <ul className="space-y-1.5">
      {logs.map((l) => (
        <li key={l.id} className="rounded-lg border border-white/5 bg-obsidian/40 px-2.5 py-2">
          <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(open === l.id ? null : l.id)}>
            <span className="num mt-0.5 shrink-0 text-[10px] text-white/35">{fmtTime(l.time)}</span>
            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-px text-[9px] font-bold tracking-wider ${KIND_STYLE[l.kind]}`}>{l.kind}</span>
            <span className="text-xs leading-relaxed text-white/80">{l.summary}</span>
            {(l.checks || l.signal) && <span className="ml-auto shrink-0 text-[10px] text-white/30">{open === l.id ? "▲" : "▼"}</span>}
          </button>
          {open === l.id && (
            <div className="mt-2 space-y-2 pl-[88px]">
              {l.signal && (
                <p className="num text-[11px] text-white/50">
                  spread {l.signal.spreadPct.toFixed(3)}% · momentum {l.signal.momentumPct.toFixed(3)}% · vol {l.signal.volatilityPct.toFixed(3)}% · score{" "}
                  {(l.signal.score * 100).toFixed(0)}
                </p>
              )}
              {l.checks && (
                <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                  {l.checks.map((c) => (
                    <p key={c.rule} className="text-[11px]">
                      <span className={c.pass ? "text-emerald" : "text-crimson"}>{c.pass ? "✓" : "✕"}</span>{" "}
                      <span className="text-white/70">{c.rule}</span> <span className="num text-white/35">{c.detail}</span>
                    </p>
                  ))}
                </div>
              )}
              {l.reasonHash && <p className="num truncate text-[10px] text-white/30">journal hash {l.reasonHash}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Receipts() {
  const receipts = useAgentStore((s) => s.receipts);
  if (!receipts.length) return <p className="py-6 text-center text-xs text-white/35">Executed swaps and their on-chain receipts appear here.</p>;
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-[10px] uppercase tracking-wider text-white/35">
        <tr>
          <th className="py-1.5 font-medium">Time</th>
          <th className="font-medium">Side</th>
          <th className="font-medium">Pair</th>
          <th className="font-medium">In → Out</th>
          <th className="font-medium">Price</th>
          <th className="font-medium">Tx / decision hash</th>
        </tr>
      </thead>
      <tbody className="num">
        {receipts.map((r) => (
          <tr key={r.id} className="border-t border-white/5 text-white/75">
            <td className="py-1.5">{fmtTime(r.time)}</td>
            <td className={r.side === "BUY" ? "text-cyan" : "text-emerald"}>{r.side}</td>
            <td className="font-sans">{r.pair}</td>
            <td>
              {r.amountIn.toFixed(r.side === "BUY" ? 2 : 2)} → {r.amountOut.toFixed(2)}
            </td>
            <td>{fmtPrice(r.price)}</td>
            <td>
              {r.txHash ? (
                <a href={explorerTx(r.txHash)} target="_blank" rel="noreferrer" className="text-cyan underline-offset-2 hover:underline">
                  {shortAddr(r.txHash)} ↗
                </a>
              ) : (
                <span className="text-white/35" title={`Decision hash ${r.reasonHash}`}>
                  SIMULATED · {shortAddr(r.reasonHash)}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PositionsLedger() {
  const [tab, setTab] = useState<Tab>("positions");
  const nPositions = useAgentStore((s) => s.positions.length);
  const tabs: { id: Tab; label: string }[] = [
    { id: "positions", label: `Active Positions & Live PnL${nPositions ? ` (${nPositions})` : ""}` },
    { id: "logs", label: "Agent Decision Logs" },
    { id: "receipts", label: "On-Chain Receipts" },
    { id: "vault", label: "Vault" },
  ];
  return (
    <section className="card flex min-h-0 flex-col p-4">
      <div className="scroll-thin mb-3 flex gap-1 overflow-x-auto border-b border-white/5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px shrink-0 border-b-2 px-3 pb-2 text-xs font-semibold ${tab === t.id ? "border-cyan text-white" : "border-transparent text-white/40 hover:text-white/70"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        {tab === "positions" && <Positions />}
        {tab === "logs" && <Logs />}
        {tab === "receipts" && <Receipts />}
        {tab === "vault" && <VaultPanel />}
      </div>
    </section>
  );
}

export default PositionsLedger;
