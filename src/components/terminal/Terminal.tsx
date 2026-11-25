"use client";

import { useEffect } from "react";
import { KairoxAuthModal } from "@/components/auth/KairoxAuthModal";
import { useAgentStore } from "@/store/agentStore";
import { refreshStatus } from "@/store/status";
import { AgentChatPanel } from "./AgentChatPanel";
import { KairoxChart } from "./KairoxChart";
import { PerformanceCard } from "./PerformanceCard";
import { PositionsLedger } from "./PositionsLedger";
import { RiskGuardrailsPanel } from "./RiskGuardrailsPanel";
import { TopBar } from "./TopBar";

/** Drives the autonomous loop: one market scan every `scanIntervalSec` (1s in replay). */
function useAgentLoop() {
  const sessionKind = useAgentStore((s) => s.session.kind);
  const intervalSec = useAgentStore((s) => (s.dataSource === "replay" ? 1 : s.config.scanIntervalSec));
  const tick = useAgentStore((s) => s.tick);

  useEffect(() => {
    if (sessionKind === "none") return;
    void tick();
    const id = setInterval(() => void tick(), intervalSec * 1000);
    return () => clearInterval(id);
  }, [sessionKind, intervalSec, tick]);
}

export function Terminal() {
  const loadHistory = useAgentStore((s) => s.loadHistory);
  const pair = useAgentStore((s) => s.pair);
  const warning = useAgentStore((s) => s.warning);
  const signedOut = useAgentStore((s) => s.session.kind === "none");
  const setAuthOpen = useAgentStore((s) => s.setAuthOpen);

  useAgentLoop();

  useEffect(() => {
    void loadHistory(pair);
    void refreshStatus();
    setAuthOpen(true);
    const id = setInterval(() => void refreshStatus(), 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col gap-3 p-3 lg:h-screen">
      <TopBar />
      {warning && <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-xs text-amber-200">{warning}</div>}
      {signedOut && (
        <button onClick={() => setAuthOpen(true)} className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-1.5 text-left text-xs text-cyan/90 hover:bg-cyan/10">
          The agent is idle. Sign in, connect a wallet, or open the Judge Sandbox to start it →
        </button>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[32fr_68fr]">
        <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 max-lg:grid-rows-[auto_520px]">
          <RiskGuardrailsPanel />
          <AgentChatPanel />
        </aside>
        <div className="grid min-h-0 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3 max-lg:grid-rows-[420px_auto]">
          <KairoxChart />
          <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1fr_260px]">
            <PositionsLedger />
            <PerformanceCard />
          </div>
        </div>
      </main>
      <KairoxAuthModal />
    </div>
  );
}

export default Terminal;
