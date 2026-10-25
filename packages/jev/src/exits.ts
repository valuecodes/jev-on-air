// The engine's own exits: stops and take-profits sized by each position's
// volatility at entry, and a count per instrument so a decision made on a
// book the engine has since closed can be caught.
import type { InstrumentId } from "@repo/alpaca/instruments";

import type { Position } from "./portfolio";
import type { Exit } from "./questions";

type ExitLevels = {
  /** Usual 15-minute moves lost before a stop; 0 disables. */
  stopZ: number;
  /** Usual 15-minute moves gained before a take-profit; 0 disables. */
  takeProfitZ: number;
};

/**
 * The exit `price` triggers for `position`, measured in usual 15-minute
 * moves (`volatility·√15`) from its average price, with the threshold move
 * in percent; `undefined` while neither level is crossed.
 */
const exitFor = (
  position: Position,
  price: number,
  volatility: number,
  levels: ExitLevels
): { exit: Exit; threshold: number } | undefined => {
  const move =
    (position.side === "long" ? 1 : -1) * (price / position.avgPrice - 1) * 100;
  const usual = volatility * Math.sqrt(15);
  if (levels.stopZ > 0 && move <= -levels.stopZ * usual) {
    return { exit: "stop", threshold: -levels.stopZ * usual };
  }
  if (levels.takeProfitZ > 0 && move >= levels.takeProfitZ * usual) {
    return { exit: "take-profit", threshold: levels.takeProfitZ * usual };
  }
  return undefined;
};

class ExitBook {
  /** Bumped by every exit the engine makes, so a stale decision is caught. */
  private readonly counts = new Map<InstrumentId, number>();
  /** The kind of each instrument's latest engine exit, for the rejection. */
  private readonly last = new Map<InstrumentId, Exit>();
  /** Volatility when each position was opened; what its stops are sized by. */
  private readonly entryVolatility = new Map<InstrumentId, number>();

  /** The exit counts now, to compare against with `closedSince`. */
  marks(): ReadonlyMap<InstrumentId, number> {
    return new Map(this.counts);
  }

  /** The kind of exit the engine made on `instrument` since `marks`, if any. */
  closedSince(
    instrument: InstrumentId,
    marks: ReadonlyMap<InstrumentId, number>
  ): Exit | undefined {
    if ((this.counts.get(instrument) ?? 0) === (marks.get(instrument) ?? 0)) {
      return undefined;
    }
    return this.last.get(instrument) ?? "stop";
  }

  /**
   * Keeps each position's entry volatility: set when it opens (or, for one
   * resumed from disk, at the first volatility known), kept when it grows,
   * forgotten when it goes flat.
   */
  track(
    instrument: InstrumentId,
    open: boolean,
    volatility: number | undefined
  ): void {
    if (!open) {
      this.entryVolatility.delete(instrument);
      return;
    }
    if (volatility !== undefined && !this.entryVolatility.has(instrument)) {
      this.entryVolatility.set(instrument, volatility);
    }
  }

  entry(instrument: InstrumentId): number | undefined {
    return this.entryVolatility.get(instrument);
  }

  /** Notes an exit the engine made, which also forgets the entry. */
  record(instrument: InstrumentId, exit: Exit): void {
    this.counts.set(instrument, (this.counts.get(instrument) ?? 0) + 1);
    this.last.set(instrument, exit);
    this.entryVolatility.delete(instrument);
  }
}

export { exitFor, ExitBook };
