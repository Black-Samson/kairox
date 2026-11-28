"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type AutoscaleInfo,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type UTCTimestamp,
} from "lightweight-charts";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { Candle } from "@/lib/agent/types";
import { TIMEFRAME_IDS } from "@/lib/market/timeframes";
import { useAgentStore } from "@/store/agentStore";

const CYAN = "#00F0FF";
const EMERALD = "#10B981";
const CRIMSON = "#F43F5E";

const fmtVol = (v?: number) =>
  v === undefined ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0);

/** O / H / L / C / change / volume readout for the hovered (or latest) candle. */
function OhlcReadout({ c }: { c?: Candle }) {
  if (!c) return null;
  const ch = ((c.close - c.open) / c.open) * 100;
  const tone = ch >= 0 ? "text-emerald" : "text-crimson";
  const Item = ({ k, v }: { k: string; v: string }) => (
    <span>
      <span className="text-white/35">{k}</span> <span className={tone}>{v}</span>
    </span>
  );
  return (
    <span className="num flex flex-wrap items-center gap-x-2.5 text-[11px]">
      <Item k="O" v={fmtPrice(c.open)} />
      <Item k="H" v={fmtPrice(c.high)} />
      <Item k="L" v={fmtPrice(c.low)} />
      <Item k="C" v={fmtPrice(c.close)} />
      <span className={tone}>{fmtPct(ch, 2)}</span>
      {c.volume !== undefined && c.volume > 0 && (
        <span>
          <span className="text-white/35">Vol</span> <span className="text-white/70">{fmtVol(c.volume)}</span>
        </span>
      )}
    </span>
  );
}

export function KairoxChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const refLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const [hovered, setHovered] = useState<Candle | undefined>();
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
  const timeframe = useAgentStore((s) => s.timeframe);
  const setTimeframe = useAgentStore((s) => s.setTimeframe);
  const replay = useAgentStore((s) => s.dataSource === "replay");
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
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: true,
        secondsVisible: true,
        barSpacing: 9,
        minBarSpacing: 3,
        rightOffset: 6,
      },
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
      // Keep at least ±1.5% around the price so tiny moves don't fill the whole chart.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (!res || !res.priceRange) return res;
        const { minValue, maxValue } = res.priceRange;
        const mid = (minValue + maxValue) / 2;
        const half = Math.max((maxValue - minValue) / 2, mid * 0.015);
        return { ...res, priceRange: { minValue: mid - half, maxValue: mid + half } };
      },
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
    // Volume pane: bottom ~20% of the chart, on its own scale.
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });

    // OHLC readout follows the crosshair; falls back to the latest candle.
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return setHovered(undefined);
      setHovered(candlesRef.current.find((c) => c.time === param.time));
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    refLineRef.current = refSeries;
    volumeRef.current = volumeSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []) as ISeriesMarkersPluginApi<UTCTimestamp>;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      refLineRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  // Candles.
  useEffect(() => {
    const s = candleRef.current;
    if (!s) return;
    candlesRef.current = candles;
    s.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    volumeRef.current?.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume ?? 0,
        color: c.close >= c.open ? "rgba(16,185,129,0.35)" : "rgba(244,63,94,0.35)",
      })),
    );
    const key = `${pair}:${interval}`;
    if (lastPairRef.current !== key && candles.length) {
      chartRef.current?.timeScale().applyOptions({ timeVisible: interval < 86_400, secondsVisible: interval < 60 });
      chartRef.current?.timeScale().fitContent();
      lastPairRef.current = key;
    }
  }, [candles, pair, interval]);

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
    <section className="card relative flex min-h-[300px] flex-col p-3 sm:p-4">
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
        <span className="ml-auto hidden items-center gap-3 text-[10px] text-white/40 sm:flex">
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
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Timeframe">
          {replay ? (
            <span className="px-2 py-0.5 text-[11px] font-semibold text-violet-300">5s · replay</span>
          ) : (
            TIMEFRAME_IDS.map((tf) => (
              <button
                key={tf}
                onClick={() => tf !== timeframe && setTimeframe(tf)}
                className={`num rounded-md px-2 py-0.5 text-[11px] font-semibold ${tf === timeframe ? "bg-raised text-cyan" : "text-white/45 hover:text-white/80"}`}
                aria-pressed={tf === timeframe}
              >
                {tf}
              </button>
            ))
          )}
        </div>
        <OhlcReadout c={hovered ?? candles.at(-1)} />
      </div>
      <div ref={containerRef} className="min-h-0 flex-1" />
    </section>
  );
}

export default KairoxChart;
