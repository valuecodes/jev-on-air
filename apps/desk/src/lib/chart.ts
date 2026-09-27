// Chart data for a run: each instrument's prices inside the run's window as
// % change from its first price there, and fills snapped onto those lines.
import type { PricePoint } from "./types";

type Instrument = PricePoint["instrument"];

export type ChartPoint = { time: number; value: number; price: number };

export type ChartLine = {
  instrument: Instrument;
  /** `time` in whole seconds, ascending and unique; `value` is % change. */
  points: ChartPoint[];
  last: number;
  /** % change from the first to the last price. */
  change: number;
};

/** A minute either side, so a line reaches the run's edges. */
const MARGIN_MS = 60_000;

/**
 * Lines for points between `from` and `to` (ms; `to` open while live). A
 * bucket seen twice (split across stream batches) keeps its later price.
 */
export function chartLines(
  points: PricePoint[],
  from: number,
  to: number | undefined
): ChartLine[] {
  const byInstrument = new Map<Instrument, Map<number, number>>();
  for (const point of points) {
    if (point.t < from - MARGIN_MS) continue;
    if (to !== undefined && point.t > to + MARGIN_MS) continue;
    let prices = byInstrument.get(point.instrument);
    if (!prices) {
      prices = new Map();
      byInstrument.set(point.instrument, prices);
    }
    prices.set(Math.floor(point.t / 1000), point.price);
  }
  const lines: ChartLine[] = [];
  for (const [instrument, prices] of byInstrument) {
    const sorted = [...prices].sort(([a], [b]) => a - b);
    const base = sorted[0]?.[1];
    const last = sorted.at(-1)?.[1];
    if (base === undefined || last === undefined) continue;
    lines.push({
      instrument,
      points: sorted.map(([time, price]) => ({
        time,
        value: (price / base - 1) * 100,
        price,
      })),
      last,
      change: (last / base - 1) * 100,
    });
  }
  return lines;
}

/** The time in `times` (ascending) nearest to `time`, if any. */
export function nearestTime(times: number[], time: number): number | undefined {
  let low = 0;
  let high = times.length - 1;
  if (high < 0) return undefined;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((times[middle] ?? 0) < time) low = middle + 1;
    else high = middle;
  }
  const after = times[low];
  const before = times[low - 1];
  if (before === undefined) return after;
  if (after === undefined) return before;
  return time - before <= after - time ? before : after;
}
