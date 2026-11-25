"use client";

import { useEffect, useRef, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { KairoxLogo } from "@/components/brand/KairoxLogo";
import { activeChain } from "@/config/chains";
import { contracts } from "@/config/contracts";
import { PAIR_IDS, type PairId } from "@/config/pairs";
import { erc20Abi } from "@/lib/chain/abis";
import { fmtPct, fmtPrice, fmtSigned, pnlClass, shortAddr } from "@/lib/format";
import { useAuthActions } from "@/providers/Web3Provider";
import { agentStatus, realizedToday, useAgentStore } from "@/store/agentStore";

const STATUS_STYLE = {
  SCANNING: "text-cyan border-cyan/30 bg-cyan/5",
  IN_POSITION: "text-emerald border-emerald/30 bg-emerald/5",
  PAUSED: "text-amber-300 border-amber-300/30 bg-amber-300/5",
  HALTED: "text-crimson border-crimson/30 bg-crimson/5",
} as const;

function ModeIndicator() {
  const mode = useAgentStore((s) => s.executionMode);
  const status = useAgentStore((s) => s.serverStatus);
  const dataSource = useAgentStore((s) => s.dataSource);
  const [open, setOpen] = useState(false);

  let label = "Judge Sandbox";
  let dot = "bg-amber-300";
  if (dataSource === "replay") {
    label = "Demo Replay · Sandbox";
    dot = "bg-violet-400";
  } else if (mode === "live") {
    label = `Live · ${activeChain.name}`;
    dot = "bg-emerald";
  } else if (status?.marketMode === "onchain") {
    label = "Live HSKSwap · Sandbox Execution";
    dot = "bg-cyan";
  } else if (status) {
    label = "Live Market · Sandbox Execution";
    dot = "bg-cyan";
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/60 hover:text-white">
        <span className={`h-1.5 w-1.5 rounded-full ${dot} kx-pulse`} />
        {label}
      </button>
      {open && status && (
        <div className="absolute left-0 top-9 z-40 w-80 rounded-xl border border-white/10 bg-surface p-3 text-xs text-white/70 shadow-2xl">
          <p className="mb-2 font-semibold text-white">Network: {activeChain.name} ({activeChain.id})</p>
          <p>Market data: {status.marketMode === "onchain" ? `HSKSwap ${status.hskswapVersion.toUpperCase()} on-chain quotes` : "external reference + simulated DEX"}</p>
          <p>Copilot: {status.llm ? "LLM" : "rule-based parser (no LLM_API_KEY)"}</p>
          <p>Live trading: {status.liveAvailable ? "available — enable it in the Vault tab" : "not configured"}</p>
          {status.issues.length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-white/10 pt-2 text-white/50">
              {status.issues.map((i) => (
                <li key={i}>• {i}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function AccountButton() {
  const session = useAgentStore((s) => s.session);
  const setAuthOpen = useAgentStore((s) => s.setAuthOpen);
  const signOut = useAgentStore((s) => s.signOut);
  const executionMode = useAgentStore((s) => s.executionMode);
  const cash = useAgentStore((s) => s.cashUsd);
  const { logout } = useAuthActions();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const address = session.address;
  const { data: hsk } = useBalance({ address, query: { enabled: !!address, refetchInterval: 20_000 } });
  const { data: usdt } = useReadContract({
    address: contracts.usdt,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!contracts.usdt, refetchInterval: 20_000 },
  });
  const { data: usdtDec } = useReadContract({
    address: contracts.usdt,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!contracts.usdt },
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (session.kind === "none") {
    return (
      <button onClick={() => setAuthOpen(true)} className="rounded-xl border border-cyan/40 bg-cyan/10 px-4 py-2 text-sm font-semibold text-cyan transition hover:bg-cyan/20">
        Sign In / Connect
      </button>
    );
  }

  const badge =
    session.kind === "sandbox" ? "SANDBOX" : session.method === "google" ? "GOOGLE" : session.method === "twitter" ? "X" : session.method === "email" ? "EMAIL" : session.method === "passkey" ? "PASSKEY" : "WALLET";

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 rounded-xl border border-white/10 bg-raised px-3 py-2 text-sm hover:bg-raised-hover">
        <span className="rounded-md bg-cyan/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-cyan">{badge}</span>
        <span className={`text-white/90 ${address ? "num" : ""}`}>{address ? shortAddr(address) : session.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-72 rounded-xl border border-white/10 bg-surface p-3 shadow-2xl">
          {session.label && <p className="mb-1 truncate text-xs text-white/50">{session.label}</p>}
          {address && (
            <button
              onClick={() => {
                void navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="num mb-3 w-full truncate rounded-lg bg-obsidian px-2 py-1.5 text-left text-xs text-white/80 hover:text-white"
              title="Copy address"
            >
              {copied ? "Copied ✓" : address}
            </button>
          )}
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-obsidian p-2">
              <p className="text-white/40">HSK</p>
              <p className="num text-white">{hsk ? Number(formatUnits(hsk.value, hsk.decimals)).toFixed(4) : "—"}</p>
            </div>
            <div className="rounded-lg bg-obsidian p-2">
              <p className="text-white/40">{executionMode === "sandbox" ? "Sim USDT" : "USDT"}</p>
              <p className="num text-white">
                {executionMode === "sandbox" ? cash.toFixed(2) : usdt !== undefined ? Number(formatUnits(usdt, usdtDec ?? 6)).toFixed(2) : "—"}
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              setOpen(false);
              if (session.kind === "sandbox") signOut();
              else await logout();
            }}
            className="w-full rounded-lg border border-crimson/30 py-2 text-xs font-semibold text-crimson hover:bg-crimson/10"
          >
            {session.kind === "sandbox" ? "Exit sandbox" : "Disconnect"}
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const pair = useAgentStore((s) => s.pair);
  const setPair = useAgentStore((s) => s.setPair);
  const last = useAgentStore((s) => s.ticks[s.pair].at(-1));
  const closed = useAgentStore((s) => s.closed);
  const paused = useAgentStore((s) => s.paused);
  const positions = useAgentStore((s) => s.positions);
  const config = useAgentStore((s) => s.config);
  const setPaused = useAgentStore((s) => s.setPaused);
  const emergencyClose = useAgentStore((s) => s.emergencyClose);
  const dataSource = useAgentStore((s) => s.dataSource);
  const setDataSource = useAgentStore((s) => s.setDataSource);
  const session = useAgentStore((s) => s.session);
  const status = agentStatus({ paused, positions, closed, config });
  const pnl24 = closed.filter((c) => Date.now() - c.closedAt < 86_400_000).reduce((a, c) => a + c.realizedPnlUsd, 0);
  const today = realizedToday(closed);

  return (
    <header className="card flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
      <KairoxLogo size={26} />

      <select
        value={pair}
        onChange={(e) => setPair(e.target.value as PairId)}
        className="rounded-lg border border-white/10 bg-raised px-2 py-1.5 text-sm font-semibold text-white outline-none"
        aria-label="Trading pair"
      >
        {PAIR_IDS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-5 text-sm">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">HSKSwap</p>
          <p className="num font-semibold text-white">{fmtPrice(last?.dexPrice)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/40">Ref spread</p>
          <p className={`num font-semibold ${last && last.spreadPct >= config.entrySpreadPct ? "text-emerald" : "text-white/80"}`}>{fmtPct(last?.spreadPct, 3)}</p>
        </div>
        <div className={`rounded-full border px-2.5 py-1 text-xs ${pnl24 >= 0 ? "border-emerald/30 bg-emerald/5" : "border-crimson/30 bg-crimson/5"}`}>
          <span className="text-white/50">24h PnL </span>
          <span className={`num font-semibold ${pnlClass(pnl24)}`}>{fmtSigned(pnl24)} USDT</span>
        </div>
      </div>

      <ModeIndicator />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-white/10 p-0.5 text-[11px]">
          {(["live", "replay"] as const).map((d) => (
            <button
              key={d}
              onClick={() => d !== dataSource && setDataSource(d)}
              className={`rounded-md px-2.5 py-1 font-semibold uppercase tracking-wider ${dataSource === d ? "bg-raised text-white" : "text-white/40 hover:text-white/70"}`}
            >
              {d === "live" ? "Live data" : "Replay"}
            </button>
          ))}
        </div>

        <span className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold tracking-wider ${STATUS_STYLE[status]}`} title={status === "HALTED" ? `Daily loss limit hit (${today.toFixed(2)} USDT)` : undefined}>
          <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "SCANNING" && session.kind !== "none" ? "kx-pulse" : ""}`} />
          {status.replace("_", " ")}
        </span>

        <button
          onClick={() => setPaused(!paused)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${paused ? "border-emerald/40 text-emerald hover:bg-emerald/10" : "border-amber-300/40 text-amber-300 hover:bg-amber-300/10"}`}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={() => void emergencyClose()}
          className="rounded-lg bg-crimson px-3 py-1.5 text-xs font-bold text-white shadow-[0_0_20px_-4px_rgba(244,63,94,0.7)] hover:brightness-110"
          title="Pause the agent and close every position at market"
        >
          ■ Emergency Close
        </button>
        <AccountButton />
      </div>
    </header>
  );
}

export default TopBar;
