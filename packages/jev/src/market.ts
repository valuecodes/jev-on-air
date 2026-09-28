// How each market is moving: recent returns, volatility, volume against its
// own baseline and the spread, from a rolling hour of one-minute buckets.
// Buckets are keyed by the minute they end, from the tick's exchange time, so
// a live trade at 12:00:30 and a historical bar stamped 12:01:00 (bars carry
// their end time) land in the same bucket. Only minutes that have ended feed
// volatility and volume; returns end at the latest price.
import type { InstrumentId } from "@repo/alpaca/instruments";
import type { PriceTick } from "@repo/alpaca/prices";

export type MarketFeatures = {
  /** Percent change from about five minutes ago to the latest price. */
  return5m: number | undefined;
  /** Percent change from about fifteen minutes ago to the latest price. */
  return15m: number | undefined;
  /** Standard deviation of one-minute log returns, in percent per minute. */
  volatility: number | undefined;
  /** `return5m` in usual five-minute moves: `return5m / (volatility·√5)`. */
  moveZ5m: number | undefined;
  /** Trade volume of the last five minutes against the older minutes. */
  relativeVolume: number | undefined;
  /** Latest bid/ask spread in basis points of the midpoint. */
  spreadBps: number | undefined;
};

type Bucket = {
  /** Epoch ms the minute ends at. */
  end: number;
  close: number;
  /** Exchange time of the tick that set `close`. */
  closeAt: number;
  volume: number;
};

type Tape = {
  buckets: Map<number, Bucket>;
  latest: { price: number; at: number } | undefined;
  spreadBps: number | undefined;
};

export type MarketTapeOptions = {
  /** How much history is kept, in milliseconds (default one hour). */
  windowMs?: number;
};

const minute = 60_000;
// Fewer one-minute returns than this say little about volatility.
const minReturns = 10;
// Fewer older minutes than this are no baseline for volume.
const minBaselineMinutes = 10;
// Below this (percent per minute) prices were flat, not calm: a z-score or a
// volatility-sized position would divide by next to nothing.
const minVolatility = 1e-4;

export class MarketTape {
  private readonly tapes = new Map<InstrumentId, Tape>();
  private readonly windowMs: number;

  constructor(options: MarketTapeOptions = {}) {
    this.windowMs = options.windowMs ?? 60 * minute;
  }

  update(tick: PriceTick): void {
    const at = Date.parse(tick.timestamp);
    if (!Number.isFinite(at) || !Number.isFinite(tick.price) || tick.price <= 0)
      return;
    let tape = this.tapes.get(tick.instrument);
    if (!tape) {
      tape = { buckets: new Map(), latest: undefined, spreadBps: undefined };
      this.tapes.set(tick.instrument, tape);
    }
    const end = Math.ceil(at / minute) * minute;
    let bucket = tape.buckets.get(end);
    if (!bucket) {
      bucket = { end, close: tick.price, closeAt: at, volume: 0 };
      tape.buckets.set(end, bucket);
    } else if (at >= bucket.closeAt) {
      bucket.close = tick.price;
      bucket.closeAt = at;
    }
    // Quotes carry no volume; a bar's `size` is its whole minute's volume.
    if (
      tick.source === "trade" &&
      tick.size !== undefined &&
      Number.isFinite(tick.size) &&
      tick.size > 0
    )
      bucket.volume += tick.size;
    if (!tape.latest || at >= tape.latest.at) {
      tape.latest = { price: tick.price, at };
      const { bid, ask } = tick;
      if (bid !== undefined && ask !== undefined && bid > 0 && ask >= bid)
        tape.spreadBps = ((ask - bid) / ((ask + bid) / 2)) * 10_000;
    }
    this.expire(tape, tape.latest.at);
  }

  /** Loads recorded ticks, oldest first, as if they had streamed in. */
  seed(ticks: Iterable<PriceTick>): void {
    for (const tick of ticks) this.update(tick);
  }

  /** The features at `now`, or `undefined` before the first tick. */
  features(instrument: InstrumentId, now: number): MarketFeatures | undefined {
    const tape = this.tapes.get(instrument);
    if (!tape?.latest) return undefined;
    this.expire(tape, now);
    const lastEnd = Math.floor(now / minute) * minute;
    const complete = [...tape.buckets.values()]
      .filter((bucket) => bucket.end <= lastEnd)
      .sort((a, b) => a.end - b.end);

    const volatility = oneMinuteVolatility(complete);
    const latest = tape.latest.price;
    const since = (minutes: number): number | undefined => {
      // The newest ended minute between `minutes` and `minutes + 2` ago.
      const from = now - (minutes + 2) * minute;
      const to = now - minutes * minute;
      const reference = complete.findLast(
        (bucket) => bucket.end >= from && bucket.end <= to
      );
      return reference && (latest / reference.close - 1) * 100;
    };
    const return5m = since(5);
    return {
      return5m,
      return15m: since(15),
      volatility,
      moveZ5m:
        return5m === undefined || volatility === undefined
          ? undefined
          : return5m / (volatility * Math.sqrt(5)),
      relativeVolume: relativeVolume(complete, lastEnd),
      spreadBps: tape.spreadBps,
    };
  }

  private expire(tape: Tape, now: number): void {
    for (const end of tape.buckets.keys())
      if (end <= now - this.windowMs) tape.buckets.delete(end);
  }
}

/**
 * Sample standard deviation of log returns between adjacent minutes, in
 * percent. A gap (no ticks for a minute, a market closed) is skipped rather
 * than read as one minute's move.
 */
function oneMinuteVolatility(buckets: readonly Bucket[]): number | undefined {
  const returns: number[] = [];
  for (let index = 1; index < buckets.length; index += 1) {
    const previous = buckets[index - 1];
    const current = buckets[index];
    if (previous && current && current.end - previous.end === minute)
      returns.push(Math.log(current.close / previous.close));
  }
  if (returns.length < minReturns) return undefined;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  const volatility = Math.sqrt(variance) * 100;
  return Number.isFinite(volatility) && volatility >= minVolatility
    ? volatility
    : undefined;
}

/**
 * Mean volume per minute over the five minutes ending at `lastEnd`, against
 * the mean over every older minute since the oldest bucket. A minute without
 * a bucket had no trades, so it counts as zero on both sides.
 */
function relativeVolume(
  buckets: readonly Bucket[],
  lastEnd: number
): number | undefined {
  const oldest = buckets[0];
  if (!oldest) return undefined;
  const recentFrom = lastEnd - 5 * minute;
  const baselineMinutes = (recentFrom - oldest.end) / minute + 1;
  if (baselineMinutes < minBaselineMinutes) return undefined;
  let recent = 0;
  let baseline = 0;
  for (const bucket of buckets)
    if (bucket.end > recentFrom) recent += bucket.volume;
    else baseline += bucket.volume;
  const usual = baseline / baselineMinutes;
  if (!(usual > 0)) return undefined;
  return recent / 5 / usual;
}
