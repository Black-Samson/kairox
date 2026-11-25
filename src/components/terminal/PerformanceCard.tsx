"use client";

import { fmtSigned, fmtUsd, pnlClass } from "@/lib/format";
import { computeStats, realizedToday, useAgentStore } from "@/store/agentStore";

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="h-12" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${((i / (points.length - 1)) * 100).toFixed(2)},${(40 - ((p - min) / span) * 36 - 2).toFixed(2)}`)
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  const color = up ? "#10B981" : "#F43F5E";
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-12 w-full">
      <defs>
        <linearGradient id="kx-eq" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L100,40 L0,40 Z`} fill="url(#kx-eq)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function PerformanceCard() {
  const closed = useAgentStore((s) => s.closed);
  const curve = useAgentStore((s) => s.equityCurve);
  const positions = useAgentStore((s) => s.positions);
  const cash = useAgentStore((s) => s.cashUsd);
  const config = useAgentStore((s) => s.config);
  const mode = useAgentStore((s) => s.executionMode);
  const stats = computeStats(closed, curve);
  const today = realizedToday(closed);
  const unrealized = positions.reduce((a, p) => a + p.unrealizedPnlUsd, 0);
  const equity = curve.at(-1)?.equity ?? cash;
  const lossUsed = Math.min(100, Math.max(0, (-today / config.dailyLossLimitUsd) * 100));

  const Stat = ({ label, value, className = "text-white" }: { label: string; value: string; className?: string }) => (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/35">{label}</p>
      <p className={`num text-sm font-semibold ${className}`}>{value}</p>
    </div>
  );

  return (
    <section className="card flex min-h-0 flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="card-title">Performance</h2>
        <span className="text-[10px] text-white/35">{mode === "live" ? "vault" : "sandbox"}</span>
      </div>
      <p className="num text-2xl font-bold text-white">
        {fmtUsd(equity)} <span className="text-xs font-normal text-white/40">USDT equity</span>
      </p>
      <Sparkline points={curve.slice(-300).map((p) => p.equity)} />
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Stat label="Realized" value={fmtSigned(stats.realized)} className={pnlClass(stats.realized)} />
        <Stat label="Unrealized" value={fmtSigned(unrealized)} className={pnlClass(unrealized)} />
        <Stat label="Win rate" value={stats.trades ? `${(stats.winRate * 100).toFixed(0)}%` : "—"} />
        <Stat label="Trades" value={String(stats.trades)} />
        <Stat label="Max drawdown" value={`-${stats.maxDrawdownUsd.toFixed(2)}`} className={stats.maxDrawdownUsd > 0 ? "text-crimson" : "text-white"} />
        <Stat label="Fees paid" value={stats.fees.toFixed(2)} />
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10px] text-white/40">
          <span>Daily loss limit used</span>
          <span className="num">
            {Math.max(0, -today).toFixed(2)} / {config.dailyLossLimitUsd}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full rounded-full transition-all ${lossUsed >= 100 ? "bg-crimson" : lossUsed > 60 ? "bg-amber-300" : "bg-emerald"}`} style={{ width: `${lossUsed}%` }} />
        </div>
      </div>
    </section>
  );
}

export default PerformanceCard;
