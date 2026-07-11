"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

type ChartBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type ChartResponse = {
  bars?: ChartBar[];
  source?: "yahoo" | "broker" | "position-tracker" | null;
  error?: string;
};

type PriceLevel = {
  label: string;
  value: number;
  color: string;
  style: LineStyle;
};

type TradeChartFill = {
  side: string;
  qty: number | null;
  price: number | null;
  executedAt: string;
};

function cssColor(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

export default function TradePriceChart({
  tradeId,
  ticker,
  entry,
  exit,
  stop,
  target,
  fills,
}: {
  tradeId: string;
  ticker: string;
  entry: number | null;
  exit: number | null;
  stop: number | null;
  target: number | null;
  fills: TradeChartFill[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<ChartBar[]>([]);
  const [source, setSource] = useState<ChartResponse["source"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setBars([]);

    void fetch(`/api/journal/trades/${tradeId}/chart`, { signal: controller.signal })
      .then(async (response) => {
        const json = await response.json().catch(() => null) as ChartResponse | null;
        if (!response.ok) throw new Error(json?.error ?? `Chart request failed (${response.status})`);
        return json;
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        const nextBars = Array.isArray(json?.bars)
          ? json.bars.filter((bar) =>
              typeof bar.time === "string" &&
              [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite),
            )
          : [];
        setBars(nextBars);
        setSource(json?.source ?? null);
        if (nextBars.length < 2) setError("Price history is unavailable for this trade.");
      })
      .catch((chartError) => {
        if (chartError instanceof Error && chartError.name === "AbortError") return;
        setError(chartError instanceof Error ? chartError.message : "Price history is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [tradeId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length < 2) return;

    const styles = getComputedStyle(container);
    const bg = cssColor(styles, "--bg-surface", "#ffffff");
    const fg = cssColor(styles, "--fg-3", "#64748b");
    const line = cssColor(styles, "--line", "#d9dedb");
    const gain = cssColor(styles, "--gain-fg", "#15803d");
    const loss = cssColor(styles, "--loss-fg", "#b91c1c");
    const accent = cssColor(styles, "--accent", "#168a64");
    const warn = cssColor(styles, "--warn-500", "#b7791f");

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 340,
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: fg,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: line },
        horzLines: { color: line },
      },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: false, rightOffset: 4 },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: gain,
      downColor: loss,
      borderUpColor: gain,
      borderDownColor: loss,
      wickUpColor: gain,
      wickDownColor: loss,
    });
    candles.setData(bars.map((bar): CandlestickData<Time> => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })));

    const barDates = new Set(bars.map((bar) => bar.time));
    const markerGroups = new Map<string, { time: string; side: "BUY" | "SELL"; qty: number; notional: number }>();
    for (const fill of fills) {
      const side = fill.side.toUpperCase() === "SELL" ? "SELL" : "BUY";
      const time = fill.executedAt.slice(0, 10);
      if (!barDates.has(time) || fill.qty == null || fill.price == null) continue;
      const key = `${time}|${side}`;
      const current = markerGroups.get(key) ?? { time, side, qty: 0, notional: 0 };
      current.qty += Math.abs(fill.qty);
      current.notional += Math.abs(fill.qty) * fill.price;
      markerGroups.set(key, current);
    }
    const markers: SeriesMarker<Time>[] = Array.from(markerGroups.values())
      .sort((left, right) => left.time.localeCompare(right.time) || left.side.localeCompare(right.side))
      .map((marker) => ({
        time: marker.time as Time,
        position: marker.side === "BUY" ? "belowBar" : "aboveBar",
        color: marker.side === "BUY" ? accent : loss,
        shape: marker.side === "BUY" ? "arrowUp" : "arrowDown",
        text: `${marker.side} ${marker.qty.toLocaleString("en-US", { maximumFractionDigits: 4 })} @ ${(marker.notional / marker.qty).toFixed(2)}`,
      }));
    if (markers.length) createSeriesMarkers(candles, markers);

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(bars.flatMap((bar): HistogramData<Time>[] =>
      bar.volume == null
        ? []
        : [{
            time: bar.time,
            value: bar.volume,
            color: bar.close >= bar.open ? "rgba(21, 128, 61, 0.35)" : "rgba(185, 28, 28, 0.35)",
          }],
    ));

    const levels: PriceLevel[] = [
      ...(entry != null ? [{ label: "Entry", value: entry, color: accent, style: LineStyle.Solid }] : []),
      ...(exit != null ? [{ label: "Exit", value: exit, color: warn, style: LineStyle.Dashed }] : []),
      ...(stop != null ? [{ label: "Stop", value: stop, color: loss, style: LineStyle.Dashed }] : []),
      ...(target != null ? [{ label: "Target", value: target, color: gain, style: LineStyle.Dotted }] : []),
    ];
    for (const level of levels) {
      candles.createPriceLine({
        price: level.value,
        color: level.color,
        lineStyle: level.style,
        lineWidth: 2,
        axisLabelVisible: true,
        title: level.label,
      });
    }

    chart.timeScale().fitContent();
    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? container.clientWidth);
      if (width > 0) chart.applyOptions({ width });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [bars, entry, exit, fills, stop, target]);

  const legend = [
    entry != null ? { label: "Entry", color: "var(--accent)" } : null,
    exit != null ? { label: "Exit", color: "var(--warn-500)" } : null,
    stop != null ? { label: "Stop", color: "var(--loss-fg)" } : null,
    target != null ? { label: "Target", color: "var(--gain-fg)" } : null,
  ].filter((item): item is { label: string; color: string } => item != null);

  return (
    <section className="market-panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
        <div>
          <h2 className="text-sm font-extrabold text-[var(--fg-1)]">Price Chart</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {legend.map((item) => (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-[var(--fg-3)]" key={item.label}>
                <span className="h-0.5 w-4" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </div>
        {source ? (
          <span className="rounded border border-[var(--line)] px-2 py-1 font-mono text-[9px] uppercase text-[var(--fg-3)]">
            {source === "broker"
              ? "Broker daily bars"
              : source === "position-tracker"
                ? "Position tracking bars"
                : "Yahoo daily bars"}
          </span>
        ) : null}
      </header>
      <div className="relative min-h-[340px] bg-[var(--bg-surface)]">
        <div
          aria-label={`${ticker} daily candlestick chart with execution markers and trade levels`}
          className="h-[340px] w-full"
          ref={containerRef}
          role="img"
        />
        {loading ? (
          <div className="absolute inset-0 grid place-items-center bg-[var(--bg-surface)] text-[12px] text-[var(--fg-3)]">
            Loading price history...
          </div>
        ) : null}
        {!loading && error ? (
          <div className="absolute inset-0 grid place-items-center bg-[var(--bg-surface)] px-6 text-center text-[12px] text-[var(--fg-3)]">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
