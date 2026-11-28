"use client";

import { useEffect, useState, type ReactNode } from "react";
import { KairoxAuthModal } from "@/components/auth/KairoxAuthModal";
import { useAgentStore } from "@/store/agentStore";
import { refreshStatus } from "@/store/status";
import { AgentChatPanel } from "./AgentChatPanel";
import { KairoxChart } from "./KairoxChart";
import { PerformanceCard } from "./PerformanceCard";
import { PositionsLedger } from "./PositionsLedger";
import { RiskGuardrailsPanel } from "./RiskGuardrailsPanel";
import { MobileTopBar, TopBar } from "./TopBar";

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

/** True below Tailwind's `lg` breakpoint (phones and small tablets). */
function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

function Banners() {
  const warning = useAgentStore((s) => s.warning);
  const signedOut = useAgentStore((s) => s.session.kind === "none");
  const setAuthOpen = useAgentStore((s) => s.setAuthOpen);
  return (
    <>
      {warning && <div className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-1.5 text-xs text-amber-200">{warning}</div>}
      {signedOut && (
        <button onClick={() => setAuthOpen(true)} className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-2 text-left text-xs text-cyan/90 hover:bg-cyan/10">
          The agent is idle. Sign in, connect a wallet, or open the Judge Sandbox to start it →
        </button>
      )}
    </>
  );
}

type MobileTab = "chart" | "trades" | "copilot" | "risk";

const TAB_ICONS: Record<MobileTab, ReactNode> = {
  chart: (
    <path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-6" strokeLinecap="round" strokeLinejoin="round" />
  ),
  trades: <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />,
  copilot: (
    <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
  ),
  risk: <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" strokeLinejoin="round" />,
};

function MobileTerminal() {
  const [tab, setTab] = useState<MobileTab>("chart");
  const openPositions = useAgentStore((s) => s.positions.length);
  const chatCount = useAgentStore((s) => s.chat.length);
  const [seenChat, setSeenChat] = useState(chatCount);
  useEffect(() => {
    if (tab === "copilot") setSeenChat(chatCount);
  }, [tab, chatCount]);

  const tabs: { id: MobileTab; label: string; badge?: number | boolean }[] = [
    { id: "chart", label: "Chart" },
    { id: "trades", label: "Trades", badge: openPositions || undefined },
    { id: "copilot", label: "Copilot", badge: chatCount > seenChat },
    { id: "risk", label: "Risk" },
  ];

  return (
    <div className="flex h-[100dvh] flex-col gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <MobileTopBar />
      <Banners />

      <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2 scroll-thin">
        {tab === "chart" && (
          <>
            <div className="flex h-[52dvh] min-h-[300px] shrink-0 flex-col [&>section]:flex-1">
              <KairoxChart />
            </div>
            <PerformanceCard />
          </>
        )}
        {tab === "trades" && (
          <div className="flex min-h-0 flex-1 flex-col [&>section]:flex-1">
            <PositionsLedger />
          </div>
        )}
        {tab === "copilot" && (
          <div className="flex min-h-0 flex-1 flex-col [&>section]:flex-1">
            <AgentChatPanel />
          </div>
        )}
        {tab === "risk" && <RiskGuardrailsPanel />}
      </main>

      <nav
        className="-mx-2 grid shrink-0 grid-cols-4 border-t border-white/10 bg-surface/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur"
        aria-label="Sections"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-semibold ${tab === t.id ? "text-cyan" : "text-white/45"}`}
            aria-current={tab === t.id ? "page" : undefined}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              {TAB_ICONS[t.id]}
            </svg>
            {t.label}
            {t.badge ? (
              <span className="absolute right-[22%] top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald px-1 text-[9px] font-bold text-ink">
                {typeof t.badge === "number" ? t.badge : ""}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

function DesktopTerminal() {
  return (
    <div className="flex min-h-screen flex-col gap-3 p-3 lg:h-screen">
      <TopBar />
      <Banners />
      <main className="grid min-h-0 flex-1 grid-cols-[32fr_68fr] gap-3">
        <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <RiskGuardrailsPanel />
          <AgentChatPanel />
        </aside>
        <div className="grid min-h-0 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
          <KairoxChart />
          <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[1fr_260px]">
            <PositionsLedger />
            <PerformanceCard />
          </div>
        </div>
      </main>
    </div>
  );
}

export function Terminal() {
  const loadHistory = useAgentStore((s) => s.loadHistory);
  const pair = useAgentStore((s) => s.pair);
  const setAuthOpen = useAgentStore((s) => s.setAuthOpen);
  const mobile = useIsMobile();

  useAgentLoop();

  useEffect(() => {
    void loadHistory(pair);
    void refreshStatus();
    setAuthOpen(true);
    const id = setInterval(() => void refreshStatus(), 20_000);
    // Refresh candle history every minute so volume bars and closed candles stay accurate.
    const hist = setInterval(() => {
      const st = useAgentStore.getState();
      if (st.dataSource === "live" && st.session.kind !== "none") void st.loadHistory(st.pair);
    }, 60_000);
    return () => {
      clearInterval(id);
      clearInterval(hist);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {mobile ? <MobileTerminal /> : <DesktopTerminal />}
      <KairoxAuthModal />
    </>
  );
}

export default Terminal;
