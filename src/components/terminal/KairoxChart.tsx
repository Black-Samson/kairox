"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { fmtPct, fmtPrice } from "@/lib/format";
import { useAgentStore } from "@/store/agentStore";

const CYAN = "#00F0FF";
const EMERALD = "#10B981";
const CRIMSON = "#F43F5E";

export function KairoxChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const refLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastPairRef = useRef<string>("");

  const pair = useAgentStore((s) => s.pair);
  const candles = useAgentStore((s) => s.candles[s.pair]);
  const ticks = useAgentStore((s) => s.ticks[s.pair]);
  const positions = useAgentStore((s) => s.positions);
  const receipts = useAgentStore((s) => s.receipts);
  const interval = useAgentStore((s) => s.candleIntervalSec);
  const candleSource = useAgentStore((s) => s.candleSource);
  const signal = useAgentStore((s) => s.signals[s.pair]);
  const last = ticks.at(-1);

  // Create chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(230,233,239,0.55)",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: true },
      localization: { priceFormatter: (p: number) => fmtPrice(p) },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: EMERALD,
      downColor: CRIMSON,
      borderUpColor: EMERALD,
      borderDownColor: CRIMSON,
      wickUpColor: EMERALD,
      wickDownColor: CRIMSON,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });
    const refSeries = chart.addSeries(LineSeries, {
      color: "rgba(255,255,255,0.35)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });
    chartRef.current = chart;
    candleRef.current = candleSeries;
    refLineRef.current = refSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []) as ISeriesMarkersPluginApi<UTCTimestamp>;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      refLineRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // Candles.
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    s.setData(candles.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    if (lastPairRef.current !== pair) {
      chartRef.current?.timeScale().fitContent();
      lastPairRef.current = pair;
    }
  }, [candles, pair]);

  // Reference price overlay (one point per candle bucket).
  useEffect(() => {
    const s = refLineRef.current;
    if (!s) return;
    const byBucket = new Map<number, number>();
    for (const t of ticks) byBucket.set(Math.floor(t.time / 1000 / interval) * interval, t.refPrice);
    s.setData([...byBucket.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
  }, [ticks, interval]);

  // Entry / stop-loss / take-profit price lines for open positions on this pair.
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    priceLinesRef.current.forEach((l) => s.removePriceLine(l));
    priceLinesRef.current = [];
    for (const p of positions.filter((x) => x.pair === pair)) {
      priceLinesRef.current.push(
        s.createPriceLine({ price: p.entryPrice, color: CYAN, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "ENTRY" }),
        s.createPriceLine({ price: p.stopLossPrice, color: CRIMSON, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "SL" }),
        s.createPriceLine({ price: p.takeProfitPrice, color: EMERALD, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "TP" }),
      );
    }
  }, [positions, pair]);

  // Buy / sell execution markers.
  useEffect(() => {
    const m = markersRef.current;
    if (!m) return;
    const first = candles[0]?.time ?? 0;
    const markers: SeriesMarker<UTCTimestamp>[] = receipts
      .filter((r) => r.pair === pair)
      .map((r) => ({ r, time: Math.floor(r.time / 1000 / interval) * interval }))
      .filter(({ time }) => time >= first)
      .sort((a, b) => a.time - b.time)
      .map(({ r, time }) => ({
        time: time as UTCTimestamp,
        position: r.side === "BUY" ? "belowBar" : "aboveBar",
        shape: r.side === "BUY" ? "arrowUp" : "arrowDown",
        color: r.side === "BUY" ? CYAN : EMERALD,
        text: r.side === "BUY" ? "BUY" : "SELL",
      }));
    m.setMarkers(markers);
  }, [receipts, pair, candles, interval]);

  return (
    <section className="card relative flex min-h-[320px] flex-col p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="card-title">{pair} · HSKSwap</h2>
        <span className="num text-sm text-white">{fmtPrice(last?.dexPrice)}</span>
        <span className="num text-xs text-white/40">ref {fmtPrice(last?.refPrice)}</span>
        <span className={`num text-xs ${last && last.spreadPct > 0 ? "text-emerald" : "text-white/50"}`}>spread {fmtPct(last?.spreadPct, 3)}</span>
        {signal && (
          <span className="flex items-center gap-1.5 text-xs text-white/50">
            signal
            <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
              <span className="absolute inset-y-0 left-0 rounded-full bg-cyan transition-all" style={{ width: `${signal.score * 100}%` }} />
            </span>
            <span className="num text-white/70">{Math.round(signal.score * 100)}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-[10px] text-white/40">
          <span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dotted border-white/50" /> reference</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-cyan" /> entry</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-crimson" /> SL</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-emerald" /> TP</span>
          {last && (
            <span className="rounded border border-white/10 px-1.5 py-0.5 uppercase">
              dex: {last.source.dex} · ref: {last.source.ref}
              {candleSource === "synthetic" ? " · synthetic history" : ""}
            </span>
          )}
        </span>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </section>
  );
}

export default KairoxChart;
