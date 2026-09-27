// Replays recorded transcripts and ticks through the engine: paced by their
// own timestamps with real sleeps, or as fast as possible on a virtual clock.
import { setTimeout as sleep } from "node:timers/promises";
import type { PriceTick } from "@repo/alpaca/prices";
import type { Segment } from "@repo/transcriber";

import type { EngineEvent } from "./engine";
import type { Source } from "./merge";
import { INSTRUMENT_IDS } from "./schema";

/** A value and when it happens, in milliseconds from the recording's start. */
export type Timed<T> = { at: number; value: T };

/**
 * Segments on a timeline: a line exists once its window ends. A transcript
 * file appended across several sessions restarts at zero each time; only the
 * last session is kept, since audio times of different sessions cannot be
 * aligned with the prices.
 */
export function segmentTimeline(
  segments: readonly Segment[],
  warn?: (message: string, fields: Record<string, unknown>) => void,
  /** Delay applied to every line, like a live stream's delay. */
  lagMs = 0
): Timed<EngineEvent>[] {
  let sessionStart = 0;
  segments.forEach((segment, index) => {
    if (
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.end < segment.start
    )
      throw new Error(`invalid segment times at line ${index + 1}`);
    const previous = segments[index - 1];
    if (previous && segment.start < previous.start) sessionStart = index;
  });
  if (sessionStart > 0)
    warn?.("transcript holds several sessions, replaying the last", {
      skipped: sessionStart,
    });
  return segments.slice(sessionStart).map((segment) => ({
    at: segment.end * 1000 + lagMs,
    value: { kind: "segment", segment },
  }));
}

/**
 * Ticks on a timeline relative to `originMs` (epoch milliseconds: when the
 * audio began), or to the first tick's exchange time. Ticks from before the
 * origin keep their negative offsets, so the book has prices before the
 * first line and still knows how old they are.
 */
export function tickTimeline(
  ticks: readonly PriceTick[],
  originMs?: number
): Timed<EngineEvent>[] {
  const first = ticks[0];
  if (!first) return [];
  const origin = originMs ?? Date.parse(first.timestamp);
  return ticks.map((tick, index) => {
    const at = Date.parse(tick.timestamp) - origin;
    if (!Number.isFinite(at))
      throw new Error(`invalid tick timestamp at line ${index + 1}`);
    return { at, value: { kind: "tick", tick } };
  });
}

/**
 * The items with `from <= at <= to`. A live run's tick file holds every
 * session for its video, so a replay keeps only the ticks around its own
 * transcript.
 */
export function clipTimeline<T>(
  timeline: readonly Timed<T>[],
  from: number,
  to: number
): Timed<T>[] {
  return timeline.filter((item) => item.at >= from && item.at <= to);
}

/**
 * Shifts timelines so the earliest item of any of them sits at zero, keeping
 * their relative timing; for pacing several of them side by side.
 */
export function rebase<T>(
  timelines: readonly (readonly Timed<T>[])[]
): Timed<T>[][] {
  const earliest = Math.min(
    0,
    ...timelines.map((timeline) => timeline[0]?.at ?? 0)
  );
  return timelines.map((timeline) =>
    timeline.map((item) => ({ ...item, at: item.at - earliest }))
  );
}

// A tick's exchange time must carry a zone, or it would be read as local time.
const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i;

/** Parses one line of `pnpm cli prices --json`. Throws if it is not a tick. */
export function parseTickLine(line: string): PriceTick {
  const value: unknown = JSON.parse(line);
  const fail = (): never => {
    throw new Error(`not a price tick: ${line}`);
  };
  if (typeof value !== "object" || value === null) return fail();
  const record = value as Record<string, unknown>;
  const { instrument, name, symbol, source, price, timestamp } = record;
  if (
    typeof instrument !== "string" ||
    !(INSTRUMENT_IDS as readonly string[]).includes(instrument) ||
    typeof name !== "string" ||
    typeof symbol !== "string" ||
    (source !== "trade" && source !== "quote") ||
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price <= 0 ||
    typeof timestamp !== "string" ||
    !zoned.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  )
    return fail();
  const optional = (key: "bid" | "ask" | "size"): Record<string, number> => {
    const field = record[key];
    return typeof field === "number" ? { [key]: field } : {};
  };
  return {
    instrument: instrument as PriceTick["instrument"],
    name,
    symbol,
    source,
    price,
    timestamp,
    ...optional("bid"),
    ...optional("ask"),
    ...optional("size"),
  };
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

const defaultSleep: Sleep = async (ms, signal) => {
  await sleep(ms, undefined, { signal });
};

/** Yields the timeline in order, waiting out the gaps in real time. */
export function paced<T>(
  timeline: readonly Timed<T>[],
  wait: Sleep = defaultSleep
): Source<T> {
  return async function* (signal) {
    let elapsed = 0;
    for (const item of timeline) {
      const delay = item.at - elapsed;
      if (delay > 0) {
        try {
          await wait(delay, signal);
        } catch {
          return;
        }
        elapsed = item.at;
      }
      if (signal.aborted) return;
      yield item.value;
    }
  };
}

export type FastOptions = {
  /** Virtual heartbeat cadence in milliseconds. */
  heartbeatMs: number;
  /** Epoch milliseconds the virtual clock starts from. */
  startAt: number;
  /**
   * Index of the timeline whose last item ends the replay, like `merge`'s
   * primary source; later items of the other timelines are not replayed.
   */
  primary?: number;
};

/**
 * Merges timelines by time without waiting, on a virtual clock that stands
 * at the time of the event last yielded. Heartbeats are synthesised every
 * `heartbeatMs` so time-based triggers fire as they would live.
 */
export function fast(
  timelines: readonly (readonly Timed<EngineEvent>[])[],
  options: FastOptions
): { source: Source<EngineEvent>; clock: () => number } {
  let current = 0;
  const merged = timelines
    .flatMap((timeline, order) =>
      timeline.map((item, index) => ({ ...item, order, index }))
    )
    .sort((a, b) => a.at - b.at || a.order - b.order || a.index - b.index);
  const primary = options.primary;
  const lastPrimary =
    primary === undefined ? undefined : (timelines[primary]?.length ?? 0) - 1;
  const source: Source<EngineEvent> = async function* (signal) {
    await Promise.resolve();
    if (lastPrimary !== undefined && lastPrimary < 0) return;
    let nextBeat = options.heartbeatMs;
    for (const item of merged) {
      while (options.heartbeatMs > 0 && nextBeat <= item.at) {
        if (signal.aborted) return;
        current = nextBeat;
        nextBeat += options.heartbeatMs;
        yield { kind: "heartbeat" };
      }
      if (signal.aborted) return;
      current = item.at;
      yield item.value;
      if (item.order === primary && item.index === lastPrimary) return;
    }
  };
  return { source, clock: () => options.startAt + current };
}
