import type { PriceTick } from "@repo/alpaca/prices";
import { describe, expect, it } from "vitest";

import { MarketTape } from "./market";

const base = Date.parse("2026-09-26T12:00:00.000Z");
const minute = 60_000;

const tick = (
  at: number,
  price: number,
  extra: Partial<PriceTick> = {}
): PriceTick => ({
  instrument: "gold",
  name: "Gold",
  symbol: "GLD",
  source: "trade",
  price,
  timestamp: new Date(base + at).toISOString(),
  ...extra,
});

/** One bar per minute, stamped at its end like `PriceHistory` does. */
const bars = (
  prices: readonly number[],
  size: (index: number) => number = () => 100,
  from = 1
): PriceTick[] =>
  prices.map((price, index) =>
    tick((from + index) * minute, price, { size: size(index) })
  );

// Alternating up and down moves, so volatility is known and non-zero.
const wiggle = (count: number, start = 100): number[] =>
  Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? start : start * 1.001
  );

describe("MarketTape", () => {
  it("has nothing before the first tick", () => {
    expect(new MarketTape().features("gold", base)).toBeUndefined();
  });

  it("buckets live trades and end-stamped bars of the same minute alike", () => {
    const prices = wiggle(20);
    const live = new MarketTape();
    const replayed = new MarketTape();
    prices.forEach((price, index) => {
      const end = (index + 1) * minute;
      live.update(tick(end - 40_000, price * 0.999, { size: 3 }));
      live.update(tick(end - 10_000, price, { size: 4 }));
      replayed.update(tick(end, price, { size: 7 }));
    });
    const now = base + 20 * minute + 1000;
    expect(live.features("gold", now)).toEqual(replayed.features("gold", now));
    expect(live.features("gold", now)?.volatility).toBeDefined();
  });

  it("waits for enough minutes before reporting volatility and returns", () => {
    const tape = new MarketTape();
    tape.seed(bars(wiggle(5)));
    expect(tape.features("gold", base + 5 * minute)).toMatchObject({
      volatility: undefined,
      return5m: undefined,
      return15m: undefined,
      moveZ5m: undefined,
      relativeVolume: undefined,
    });
  });

  it("measures returns from the minute that ended five and fifteen minutes ago", () => {
    const prices = Array.from({ length: 30 }, (_, index) => 100 + index);
    const tape = new MarketTape();
    tape.seed(bars(prices));
    const features = tape.features("gold", base + 30 * minute);
    // The latest close is 129; five minutes earlier it was 124, fifteen 114.
    expect(features?.return5m).toBeCloseTo((129 / 124 - 1) * 100, 10);
    expect(features?.return15m).toBeCloseTo((129 / 114 - 1) * 100, 10);
    expect(features?.moveZ5m).toBeCloseTo(
      (features?.return5m ?? 0) /
        ((features?.volatility ?? Number.NaN) * Math.sqrt(5)),
      10
    );
    // Half a minute later the same reference spans five and a half minutes.
    const later = tape.features("gold", base + 30 * minute + 30_000);
    expect(later?.moveZ5m).toBeCloseTo(
      (later?.return5m ?? 0) /
        ((later?.volatility ?? Number.NaN) * Math.sqrt(5.5)),
      10
    );
  });

  it("uses only minutes that have ended for volatility", () => {
    const tape = new MarketTape();
    tape.seed(bars(wiggle(20)));
    const before = tape.features("gold", base + 20 * minute)?.volatility;
    // A spike in the minute still running moves the price, not volatility.
    tape.update(tick(20 * minute + 5000, 150));
    const after = tape.features("gold", base + 20 * minute + 10_000);
    expect(after?.volatility).toBe(before);
    // Five minutes before 12:20:10 the newest ended minute is 12:15, at 100.
    expect(after?.return5m).toBeCloseTo(50, 10);
  });

  it("skips gaps instead of reading them as one-minute moves", () => {
    const tape = new MarketTape();
    tape.seed(bars(wiggle(8, 100)));
    tape.seed(bars(wiggle(8, 200), undefined, 30));
    const volatility = tape.features("gold", base + 38 * minute)?.volatility;
    expect(volatility).toBeDefined();
    // Across the gap the price doubled; that would be about 70 % per minute.
    expect(volatility).toBeLessThan(0.2);
  });

  it("reports no volatility for flat prices, so nothing divides by zero", () => {
    const tape = new MarketTape();
    tape.seed(bars(Array.from({ length: 20 }, () => 100)));
    expect(tape.features("gold", base + 20 * minute)).toMatchObject({
      volatility: undefined,
      moveZ5m: undefined,
      return5m: 0,
    });
  });

  it("compares the last five minutes' volume with the older ones", () => {
    const tape = new MarketTape();
    tape.seed(bars(wiggle(20), (index) => (index >= 15 ? 300 : 100)));
    expect(
      tape.features("gold", base + 20 * minute)?.relativeVolume
    ).toBeCloseTo(3, 10);

    const silent = new MarketTape();
    silent.seed(bars(wiggle(20), () => 0));
    expect(
      silent.features("gold", base + 20 * minute)?.relativeVolume
    ).toBeUndefined();
  });

  it("counts trades only toward volume and keeps the latest spread", () => {
    const tape = new MarketTape();
    tape.seed(bars(wiggle(20)));
    tape.update(
      tick(20 * minute, 100, {
        source: "quote",
        size: 1_000_000,
        bid: 99.99,
        ask: 100.01,
      })
    );
    const features = tape.features("gold", base + 20 * minute);
    expect(features?.relativeVolume).toBeCloseTo(1, 10);
    expect(features?.spreadBps).toBeCloseTo(2, 10);
  });

  it("forgets minutes older than the window", () => {
    const tape = new MarketTape();
    tape.seed(bars(wiggle(20)));
    expect(tape.features("gold", base + 3 * 60 * minute)).toMatchObject({
      volatility: undefined,
      return5m: undefined,
      relativeVolume: undefined,
    });
  });

  it("keeps a minute's latest price when ticks arrive out of order", () => {
    const tape = new MarketTape();
    tape.update(tick(50_000, 101));
    tape.update(tick(20_000, 99));
    tape.seed(bars(wiggle(20), undefined, 2));
    tape.update(tick(22 * minute, 100));
    const early = new MarketTape();
    early.update(tick(50_000, 101));
    early.seed(bars(wiggle(20), undefined, 2));
    early.update(tick(22 * minute, 100));
    expect(tape.features("gold", base + 22 * minute)).toEqual(
      early.features("gold", base + 22 * minute)
    );
  });
});
