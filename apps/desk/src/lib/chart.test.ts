import { describe, expect, it } from "vitest";

import { chartLines, nearestTime } from "./chart";

const at = (seconds: number): number =>
  Date.parse("2026-09-27T07:00:00Z") + seconds * 1000;

describe("chartLines", () => {
  it("gives % change from each instrument's first price in the window", () => {
    const lines = chartLines(
      [
        { instrument: "gold", t: at(0), price: 100 },
        { instrument: "bitcoin", t: at(1), price: 50 },
        { instrument: "gold", t: at(2), price: 102 },
      ],
      at(0),
      undefined
    );
    const gold = lines.find((line) => line.instrument === "gold");
    expect(gold?.points[0]?.value).toBe(0);
    expect(gold?.points[1]?.value).toBeCloseTo(2);
    expect(gold).toMatchObject({ last: 102 });
    expect(gold?.change).toBeCloseTo(2);
  });

  it("drops points outside the run's window and keeps the later of a split bucket", () => {
    const lines = chartLines(
      [
        { instrument: "oil", t: at(-120), price: 1 },
        { instrument: "oil", t: at(10), price: 70 },
        { instrument: "oil", t: at(10) + 500, price: 71 },
        { instrument: "oil", t: at(400), price: 99 },
      ],
      at(0),
      at(60)
    );
    expect(lines[0]?.points).toEqual([
      { time: at(10) / 1000, value: 0, price: 71 },
    ]);
    expect(lines[0]?.last).toBe(71);
  });

  it("measures change from the run's first price, not the margin's", () => {
    const [line] = chartLines(
      [
        { instrument: "gold", t: at(-30), price: 90 },
        { instrument: "gold", t: at(0), price: 100 },
        { instrument: "gold", t: at(50), price: 110 },
        { instrument: "gold", t: at(80), price: 200 },
      ],
      at(0),
      at(60)
    );
    expect(line?.points.map((point) => point.time)).toHaveLength(4);
    expect(line?.points[1]?.value).toBe(0);
    expect(line?.last).toBe(110);
    expect(line?.change).toBeCloseTo(10);
  });
});

describe("nearestTime", () => {
  it("snaps to the closest time", () => {
    expect(nearestTime([10, 20, 30], 24)).toBe(20);
    expect(nearestTime([10, 20, 30], 26)).toBe(30);
    expect(nearestTime([10, 20, 30], 0)).toBe(10);
    expect(nearestTime([10, 20, 30], 99)).toBe(30);
    expect(nearestTime([], 5)).toBeUndefined();
  });
});
