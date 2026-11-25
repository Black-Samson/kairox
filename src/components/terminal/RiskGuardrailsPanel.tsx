"use client";

import { useEffect, useRef, useState } from "react";
import { PAIR_IDS } from "@/config/pairs";
import { clampConfigPatch, HARD_LIMITS, RISK_PRESETS } from "@/lib/agent/riskEngine";
import type { RiskConfig } from "@/lib/agent/types";
import { useAgentStore } from "@/store/agentStore";

type SliderKey = "maxTradeUsd" | "stopLossPct" | "takeProfitPct" | "maxSlippagePct" | "scanIntervalSec" | "dailyLossLimitUsd" | "entrySpreadPct";

const SLIDERS: { key: SliderKey; label: string; unit: string; step: number; max?: number; color?: string }[] = [
  { key: "maxTradeUsd", label: "Max Trade Size", unit: "USDT", step: 1, max: 250 },
  { key: "stopLossPct", label: "Stop-Loss", unit: "%", step: 0.1, max: 10, color: "#F43F5E" },
  { key: "takeProfitPct", label: "Take-Profit", unit: "%", step: 0.1, max: 15, color: "#10B981" },
  { key: "maxSlippagePct", label: "Max Slippage", unit: "%", step: 0.05, max: 3 },
  { key: "entrySpreadPct", label: "Entry Spread", unit: "%", step: 0.05, max: 2 },
  { key: "scanIntervalSec", label: "Scan Interval", unit: "sec", step: 1, max: 60 },
  { key: "dailyLossLimitUsd", label: "Daily Loss Limit", unit: "USDT", step: 1, max: 200, color: "#F43F5E" },
];

function Slider({
  def,
  value,
  ceiling,
  flash,
  onChange,
}: {
  def: (typeof SLIDERS)[number];
  value: number;
  ceiling?: number;
  flash: boolean;
  onChange: (v: number) => void;
}) {
  const min = HARD_LIMITS[def.key].min;
  const max = Math.min(def.max ?? HARD_LIMITS[def.key].max, ceiling ?? Infinity, HARD_LIMITS[def.key].max);
  const fill = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div className={`rounded-xl px-2 py-1.5 transition ${flash ? "kx-flash bg-cyan/5" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-white/70">
          {def.label}
          {ceiling !== undefined && <span className="ml-1 text-[10px] text-white/30">(vault ≤ {ceiling})</span>}
        </span>
        <span className="flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => onChange(Number(draft))}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="num w-16 rounded-md border border-white/10 bg-obsidian px-1.5 py-0.5 text-right text-xs text-white outline-none focus:border-cyan/60"
            aria-label={def.label}
          />
          <span className="w-8 text-[10px] text-white/40">{def.unit}</span>
        </span>
      </div>
      <input
        type="range"
        className="kx-range"
        min={min}
        max={max}
        step={def.step}
        value={Math.min(value, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--fill" as string]: `${fill}%`, ...(def.color ? { accentColor: def.color } : {}) }}
        aria-label={`${def.label} slider`}
      />
    </div>
  );
}

export function RiskGuardrailsPanel() {
  const config = useAgentStore((s) => s.config);
  const setConfig = useAgentStore((s) => s.setConfig);
  const live = useAgentStore((s) => s.executionMode === "live");
  const vault = useAgentStore((s) => s.serverStatus?.vault);
  const prev = useRef<RiskConfig>(config);
  const [flashKeys, setFlashKeys] = useState<string[]>([]);

  // Flash any field that changed from outside the slider (e.g. the chat copilot).
  useEffect(() => {
    const changed = (Object.keys(config) as (keyof RiskConfig)[]).filter(
      (k) => JSON.stringify(config[k]) !== JSON.stringify(prev.current[k]),
    );
    prev.current = config;
    if (changed.length) {
      setFlashKeys(changed);
      const t = setTimeout(() => setFlashKeys([]), 1000);
      return () => clearTimeout(t);
    }
  }, [config]);

  const ceilings =
    live && vault
      ? { maxTradeUsd: vault.limits.maxTradeQuote, maxSlippagePct: vault.limits.maxSlippagePct, dailyLossLimitUsd: vault.limits.dailyLossLimitQuote }
      : {};

  const update = (patch: Partial<RiskConfig>) => {
    const { patch: clean } = clampConfigPatch(patch, ceilings);
    prev.current = { ...config, ...clean }; // user-driven: no flash
    setConfig(clean);
  };

  return (
    <section className="card flex min-h-0 flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="card-title">Risk Guardrails</h2>
        <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40" title="Enforced by code before every trade; core limits are re-checked on-chain by KairoxVault">
          deterministic · non-LLM
        </span>
      </div>

      <div className="mb-3 flex gap-1.5">
        {(Object.keys(RISK_PRESETS) as (keyof typeof RISK_PRESETS)[]).map((p) => (
          <button
            key={p}
            onClick={() => update(RISK_PRESETS[p])}
            className="flex-1 rounded-lg border border-white/10 py-1 text-[11px] capitalize text-white/60 hover:border-cyan/40 hover:text-white"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="scroll-thin -mx-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {SLIDERS.map((def) => (
          <Slider
            key={def.key}
            def={def}
            value={config[def.key]}
            ceiling={(ceilings as Partial<Record<SliderKey, number>>)[def.key]}
            flash={flashKeys.includes(def.key)}
            onChange={(v) => update({ [def.key]: v })}
          />
        ))}

        <div className={`rounded-xl px-2 py-2 ${flashKeys.includes("pairs") ? "kx-flash bg-cyan/5" : ""}`}>
          <p className="mb-1.5 text-xs text-white/70">Target assets</p>
          <div className="flex gap-1.5">
            {PAIR_IDS.map((p) => {
              const on = config.pairs.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => {
                    const next = on ? config.pairs.filter((x) => x !== p) : [...config.pairs, p];
                    if (next.length) update({ pairs: next });
                  }}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${on ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-white/10 text-white/40"}`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default RiskGuardrailsPanel;
