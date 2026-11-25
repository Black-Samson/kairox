"use client";

import { useEffect, useRef, useState } from "react";
import { KxMark } from "@/components/brand/KairoxLogo";
import { useAgentStore } from "@/store/agentStore";

const SUGGESTIONS = [
  "Set stop-loss to 2%, max trade 50 USDT, and buy HSK/USDT when spread exceeds 0.4%",
  "How are we doing?",
  "Why did you make the last trade?",
  "Be more conservative",
  "Set max trade to 1000000 USDT",
];

export function AgentChatPanel() {
  const chat = useAgentStore((s) => s.chat);
  const busy = useAgentStore((s) => s.chatBusy);
  const send = useAgentStore((s) => s.sendChat);
  const llm = useAgentStore((s) => s.serverStatus?.llm);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat.length, busy]);

  const submit = (msg: string) => {
    const m = msg.trim();
    if (!m || busy) return;
    setText("");
    void send(m);
  };

  return (
    <section className="card flex min-h-0 flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="card-title">Strategy Copilot</h2>
        <span className="text-[10px] text-white/40">{llm ? "LLM" : "rule engine"} · can&apos;t trade, only configure</span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {chat.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "agent" && (
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-obsidian">
                <KxMark size={16} />
              </div>
            )}
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                m.role === "user" ? "bg-cyan/15 text-white" : "bg-raised text-white/85"
              }`}
            >
              {m.text}
              {m.changes && m.changes.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[11px] text-cyan/90">
                  {m.changes.map((c) => (
                    <li key={c} className="num">
                      ↳ {c}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="pl-8 text-xs text-white/40 kx-pulse">thinking…</div>}
        <div ref={endRef} />
      </div>

      <div className="scroll-thin my-2 flex gap-1.5 overflow-x-auto pb-1">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => submit(s)}
            className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/50 hover:border-cyan/40 hover:text-white"
          >
            {s.length > 34 ? `${s.slice(0, 34)}…` : s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about PnL or change the strategy…"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-obsidian px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-cyan/60"
        />
        <button type="submit" disabled={busy || !text.trim()} className="rounded-xl bg-cyan px-4 text-sm font-semibold text-ink disabled:opacity-40">
          Send
        </button>
      </form>
    </section>
  );
}

export default AgentChatPanel;
