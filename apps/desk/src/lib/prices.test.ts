import { describe, expect, it } from "vitest";

import { downsample } from "./prices";

const tick = (instrument: string, price: number, timestamp: string): string =>
  JSON.stringify({
    instrument,
    name: instrument,
    symbol: instrument.toUpperCase(),
    source: "quote",
    price,
    timestamp,
  });

describe("downsample", () => {
  it("keeps the last price per instrument per second, in time order", () => {
    const { points, invalid } = downsample([
      tick("gold", 100, "2026-09-27T07:00:01.100Z"),
      tick("bitcoin", 50, "2026-09-27T07:00:00.500Z"),
      tick("gold", 101, "2026-09-27T07:00:01.900Z"),
      tick("gold", 102, "2026-09-27T07:00:02.000Z"),
    ]);
    const second = Date.parse("2026-09-27T07:00:01Z");
    expect(invalid).toBe(0);
    expect(points).toEqual([
      { instrument: "bitcoin", t: second - 1000, price: 50 },
      { instrument: "gold", t: second, price: 101 },
      { instrument: "gold", t: second + 1000, price: 102 },
    ]);
  });

  it("counts lines that are not ticks", () => {
    const { points, invalid } = downsample([
      "not json",
      tick("platinum", 1, "2026-09-27T07:00:00Z"),
      tick("gold", 1, "2026-09-27T07:00:00"),
      tick("gold", 1, "2026-09-27T07:00:00Z"),
    ]);
    expect(invalid).toBe(3);
    expect(points).toHaveLength(1);
  });

  it("takes a coarser bucket", () => {
    const { points } = downsample(
      [
        tick("oil", 70, "2026-09-27T07:00:01Z"),
        tick("oil", 71, "2026-09-27T07:00:04Z"),
      ],
      5000
    );
    expect(points).toEqual([
      { instrument: "oil", t: Date.parse("2026-09-27T07:00:00Z"), price: 71 },
    ]);
  });
});
