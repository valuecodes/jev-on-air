import type { PriceTick } from "@repo/alpaca/prices";
import { describe, expect, it } from "vitest";

import type { EngineEvent } from "./engine";
import {
  fast,
  paced,
  parseTickLine,
  segmentTimeline,
  tickTimeline,
} from "./replay";
import type { Timed } from "./replay";

const tick = (timestamp: string, price = 1): PriceTick => ({
  instrument: "gold",
  name: "Gold",
  symbol: "GLD",
  source: "trade",
  price,
  timestamp,
});

describe("segmentTimeline", () => {
  it("places a line at the end of its window and keeps only the last session", () => {
    const warnings: unknown[] = [];
    const timeline = segmentTimeline(
      [
        { start: 0, end: 8, text: "old a" },
        { start: 8, end: 16, text: "old b" },
        { start: 0, end: 7.5, text: "new a" },
        { start: 7.5, end: 15, text: "new b" },
      ],
      (message, fields) => warnings.push([message, fields])
    );
    expect(
      timeline.map((item) => [
        item.at,
        item.value.kind === "segment" ? item.value.segment.text : "",
      ])
    ).toEqual([
      [7500, "new a"],
      [15_000, "new b"],
    ]);
    expect(warnings).toEqual([
      ["transcript holds several sessions, replaying the last", { skipped: 2 }],
    ]);
    expect(() => segmentTimeline([{ start: 5, end: 4, text: "" }])).toThrow(
      /line 1/
    );
  });
});

describe("tickTimeline", () => {
  it("offsets ticks from the first one's exchange time", () => {
    const timeline = tickTimeline([
      tick("2026-09-26T12:00:00.000Z"),
      tick("2026-09-26T12:00:01.500Z"),
      tick("2026-09-26T11:59:59.000Z"),
    ]);
    expect(timeline.map((item) => item.at)).toEqual([0, 1500, 0]);
    expect(tickTimeline([])).toEqual([]);
    expect(() => tickTimeline([tick("nope")])).toThrow(/line 1/);
  });
});

describe("parseTickLine", () => {
  it("accepts recorded ticks with optional fields and rejects the rest", () => {
    const line = JSON.stringify({
      ...tick("2026-09-26T12:00:00.000Z", 243.1),
      bid: 243,
      ask: 243.2,
      size: 10,
      extra: 1,
    });
    expect(parseTickLine(line)).toEqual({
      ...tick("2026-09-26T12:00:00.000Z", 243.1),
      bid: 243,
      ask: 243.2,
      size: 10,
    });
    for (const bad of [
      "[]",
      "1",
      JSON.stringify({
        ...tick("2026-09-26T12:00:00.000Z"),
        instrument: "silver",
      }),
      JSON.stringify(tick("2026-09-26T12:00:00.000Z", 0)),
      JSON.stringify(tick("yesterday")),
      JSON.stringify({ ...tick("2026-09-26T12:00:00.000Z"), source: "guess" }),
    ])
      expect(() => parseTickLine(bad)).toThrow(/not a price tick/);
  });
});

describe("paced", () => {
  it("waits out the gaps and stops when the wait is aborted", async () => {
    const waits: number[] = [];
    const timeline: Timed<string>[] = [
      { at: 0, value: "a" },
      { at: 1500, value: "b" },
      { at: 1500, value: "c" },
      { at: 4000, value: "d" },
    ];
    const values: string[] = [];
    for await (const value of paced(timeline, (ms) => {
      waits.push(ms);
      return Promise.resolve();
    })(new AbortController().signal))
      values.push(value);
    expect(values).toEqual(["a", "b", "c", "d"]);
    expect(waits).toEqual([1500, 2500]);

    const controller = new AbortController();
    const stopped: string[] = [];
    for await (const value of paced(timeline, () => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    })(controller.signal))
      stopped.push(value);
    expect(stopped).toEqual(["a"]);
  });
});

describe("fast", () => {
  it("merges timelines by time, adds heartbeats and moves the clock", async () => {
    const seg = (at: number, text: string): Timed<EngineEvent> => ({
      at,
      value: { kind: "segment", segment: { start: 0, end: at / 1000, text } },
    });
    const tk = (at: number): Timed<EngineEvent> => ({
      at,
      value: { kind: "tick", tick: tick("2026-09-26T12:00:00.000Z") },
    });
    const { source, clock } = fast(
      [
        [seg(500, "a"), seg(2500, "b")],
        [tk(500), tk(1000)],
      ],
      { heartbeatMs: 1000, startAt: 10_000 }
    );
    const seen: [number, string][] = [];
    for await (const event of source(new AbortController().signal))
      seen.push([
        clock(),
        event.kind === "segment" ? event.segment.text : event.kind,
      ]);
    expect(seen).toEqual([
      [10_500, "a"],
      [10_500, "tick"],
      [11_000, "heartbeat"],
      [11_000, "tick"],
      [12_000, "heartbeat"],
      [12_500, "b"],
    ]);
  });

  it("ends with the primary timeline, leaving later items unplayed", async () => {
    const seg = (at: number, text: string): Timed<EngineEvent> => ({
      at,
      value: { kind: "segment", segment: { start: 0, end: at / 1000, text } },
    });
    const tk = (at: number): Timed<EngineEvent> => ({
      at,
      value: { kind: "tick", tick: tick("2026-09-26T12:00:00.000Z") },
    });
    const { source, clock } = fast(
      [
        [seg(500, "a"), seg(1500, "b")],
        [tk(1000), tk(5000), tk(9000)],
      ],
      { heartbeatMs: 1000, startAt: 0, primary: 0 }
    );
    const kinds: string[] = [];
    for await (const event of source(new AbortController().signal))
      kinds.push(event.kind);
    expect(kinds).toEqual(["segment", "heartbeat", "tick", "segment"]);
    expect(clock()).toBe(1500);

    const empty = fast([[], [tk(1000)]], {
      heartbeatMs: 1000,
      startAt: 0,
      primary: 0,
    });
    const none: string[] = [];
    for await (const event of empty.source(new AbortController().signal))
      none.push(event.kind);
    expect(none).toEqual([]);
  });
});
