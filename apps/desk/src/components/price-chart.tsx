"use client";

// Prices during the run, as % change since it started so all four
// instruments share one axis, with the run's fills marked on their lines.
// Loaded client-only (next/dynamic): lightweight-charts draws on a canvas.
import type { FillEvent } from "@repo/jev/ledger";
import {
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
} from "lightweight-charts";
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesMarker,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import { ChartNoAxesCombined } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { chartLines, nearestTime } from "../lib/chart";
import type { PricePoint } from "../lib/types";
import { money } from "./format";
import { mono } from "./ui";
import { instruments } from "./visuals";

type Instrument = PricePoint["instrument"];

type Line = {
  series: ISeriesApi<"Line">;
  markers: ISeriesMarkersPluginApi<Time>;
};

const token = (name: string): string =>
  getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${name}`)
    .trim();

const localTime = (time: Time): string =>
  new Date((time as UTCTimestamp) * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

const percentLabel = (value: number): string =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function PriceChart({
  points,
  fills,
  from,
  to,
}: {
  points: PricePoint[];
  fills: FillEvent[];
  /** The run's start and end (ms); `to` is open while it runs. */
  from: number;
  to: number | undefined;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const lines = useRef(new Map<Instrument, Line>());
  const [hidden, setHidden] = useState<ReadonlySet<Instrument>>(new Set());

  const data = useMemo(() => chartLines(points, from, to), [points, from, to]);

  // The chart itself, once.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const muted = token("muted");
    const line = token("line");
    const created = createChart(element, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: muted,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line },
      timeScale: {
        borderColor: line,
        timeVisible: true,
        tickMarkFormatter: localTime,
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: percentLabel,
        timeFormatter: (time: Time) =>
          new Date((time as UTCTimestamp) * 1000).toLocaleTimeString("en-GB"),
      },
    });
    chart.current = created;
    const series = lines.current;
    return () => {
      series.clear();
      chart.current = null;
      created.remove();
    };
  }, []);

  // Lines and fill markers, whenever the data changes.
  useEffect(() => {
    const api = chart.current;
    if (!api) return;
    // Another run may lack an instrument the last one had: drop its line.
    const present = new Set(data.map((line) => line.instrument));
    for (const [instrument, line] of lines.current)
      if (!present.has(instrument)) {
        line.markers.detach();
        api.removeSeries(line.series);
        lines.current.delete(instrument);
      }
    for (const { instrument, points: linePoints } of data) {
      let line = lines.current.get(instrument);
      if (!line) {
        const series = api.addSeries(LineSeries, {
          color: token(instrument),
          lineWidth: 2,
          priceLineVisible: false,
          title: instruments[instrument].name,
        });
        line = { series, markers: createSeriesMarkers(series, []) };
        lines.current.set(instrument, line);
      }
      line.series.setData(
        linePoints.map((point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        }))
      );
      // A marker must sit on a point of its line, so snap each fill to one.
      const times = linePoints.map((point) => point.time);
      const markers: SeriesMarker<Time>[] = [];
      for (const fill of fills) {
        if (fill.instrument !== instrument) continue;
        const time = nearestTime(
          times,
          Math.floor(Date.parse(fill.time) / 1000)
        );
        if (time === undefined) continue;
        const up = fill.action === "buy";
        const close = fill.action === "close";
        markers.push({
          time: time as UTCTimestamp,
          position: up ? "belowBar" : close ? "inBar" : "aboveBar",
          shape: up ? "arrowUp" : close ? "circle" : "arrowDown",
          color: token(fill.action),
          text: fill.action.toUpperCase(),
        });
      }
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      line.markers.setMarkers(markers);
    }
  }, [data, fills]);

  useEffect(() => {
    for (const [instrument, line] of lines.current)
      line.series.applyOptions({ visible: !hidden.has(instrument) });
  }, [hidden, data]);

  const toggle = (instrument: Instrument): void =>
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(instrument)) next.add(instrument);
      return next;
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {data.map(({ instrument, last, change }) => {
          const { name, icon: Icon, chip } = instruments[instrument];
          const off = hidden.has(instrument);
          return (
            <button
              key={instrument}
              type="button"
              onClick={() => toggle(instrument)}
              aria-pressed={!off}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${off ? "border-line text-muted opacity-50" : chip}`}
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="font-semibold">{name}</span>
              <span className={mono}>{money(last)}</span>
              <span
                className={`${mono} ${change >= 0 ? "text-good" : "text-bad"}`}
              >
                {percentLabel(change)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative h-64 w-full">
        <div ref={host} className="absolute inset-0" />
        {data.length === 0 && (
          <div className="text-muted absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <ChartNoAxesCombined className="size-8" aria-hidden />
            No prices recorded for this run yet.
            <span className="text-xs">
              Live runs record ticks to <code>.cache/prices/</code>; older runs
              have none.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
