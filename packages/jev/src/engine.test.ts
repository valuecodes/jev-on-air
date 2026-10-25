import { describe, expect, it } from "vitest";

import { ScriptedDecider } from "./decider";
import { buy, line, seg, setup, tick, types } from "./engine-fixtures";

describe("Engine", () => {
  it("asks the decider once enough text is pending and fills at the latest price", async () => {
    const decider = new ScriptedDecider([buy("gold")]);
    const { engine, events } = setup(
      [
        tick(1000, "gold", 200),
        seg(5000, "short"),
        tick(6000, "gold", 210),
        seg(9000),
        tick(10_000, "gold", 220),
      ],
      { decider }
    );
    const final = await engine.run();

    expect(types(events)).toEqual([
      "start",
      "decision",
      "fill",
      "snapshot",
      "end",
    ]);
    expect(events[0]).toMatchObject({
      type: "start",
      cash: 100_000,
      equity: 100_000,
      resumed: false,
      run: "run-1",
      turn: null,
    });
    expect(events[1]).toMatchObject({
      type: "decision",
      turn: 1,
      segments: 2,
      signal: null,
      time: "2026-09-26T12:00:09.000Z",
      audioTime: 9,
    });
    expect(events[2]).toMatchObject({
      type: "fill",
      instrument: "gold",
      price: 210,
      confidence: 0.9,
    });
    expect(events[4]).toMatchObject({ type: "end", reason: "stream ended" });
    expect(final.equity).toBeCloseTo(90_000 + (10_000 / 210) * 220, 6);

    const [input] = decider.inputs;
    expect(input?.segments.map((segment) => segment.text)).toEqual([
      "short",
      line,
    ]);
    expect(input?.context).toEqual([]);
    expect(
      input?.prices.find((price) => price.instrument === "gold")
    ).toMatchObject({ price: 210, ageSeconds: 3 });
    expect(
      input?.prices.find((price) => price.instrument === "oil")
    ).toMatchObject({ price: undefined, ageSeconds: undefined });
    expect(input?.feedback).toEqual([]);
    expect(input?.now).toBe("2026-09-26T12:00:09.000Z");
  });

  it("asks on time via heartbeats when little text arrives", async () => {
    const decider = new ScriptedDecider([]);
    const { engine, events } = setup(
      [seg(1000, "hi"), tick(35_000, "gold", 200)],
      { decider }
    );
    await engine.run();
    expect(types(events)).toEqual(["start", "decision", "snapshot", "end"]);
    expect(events[1]).toMatchObject({
      type: "decision",
      time: "2026-09-26T12:00:30.000Z",
      decisions: [],
    });
  });

  it("rejects low confidence, missing prices and stale prices, and feeds that back", async () => {
    const decider = new ScriptedDecider([
      {
        decisions: [
          { instrument: "gold", action: "buy", confidence: 0.4 },
          { instrument: "oil", action: "buy", confidence: 0.9 },
          { instrument: "sp500", action: "buy", confidence: 0.9 },
          { instrument: "bitcoin", action: "buy", confidence: 0.9 },
        ],
      },
    ]);
    const { engine, events } = setup(
      [
        tick(1000, "gold", 200),
        tick(1000, "sp500", 500),
        tick(8500, "bitcoin", 50_000),
        seg(9000),
        seg(50_000),
      ],
      { decider, maxPriceAgeMs: 5000 }
    );
    await engine.run();
    expect(types(events)).toEqual([
      "start",
      "decision",
      "reject",
      "reject",
      "reject",
      "fill",
      "snapshot",
      "decision",
      "snapshot",
      "end",
    ]);
    expect(
      events
        .slice(2, 6)
        .map((event) => (event.type === "reject" ? event.reason : event.type))
    ).toEqual([
      "confidence 0.40 below 0.60",
      "no price yet for oil",
      "stale price (8 s old)",
      "fill",
    ]);
    const second = decider.inputs[1];
    expect(
      second?.feedback.map((item) => [item.turn, item.result.kind])
    ).toEqual([
      [1, "reject"],
      [1, "reject"],
      [1, "reject"],
      [1, "fill"],
    ]);
    // Lines already shown come back as context, not as new lines.
    expect(second?.context.map((segment) => segment.end)).toEqual([9]);
    expect(second?.segments.map((segment) => segment.end)).toEqual([50]);
  });

  it("forgets context older than the window and keeps recent feedback only", async () => {
    const decider = new ScriptedDecider(
      Array.from({ length: 4 }, () => buy("gold", 0.1))
    );
    const { engine } = setup(
      [
        tick(1000, "gold", 200),
        seg(9000, "a"),
        seg(50_000, "b"),
        seg(90_000, "c"),
        seg(130_000, "d"),
      ],
      { decider, contextSeconds: 60, maxFeedback: 2 }
    );
    await engine.run();
    const last = decider.inputs[3];
    expect(last?.context.map((segment) => segment.text)).toEqual(["c"]);
    expect(last?.feedback.map((item) => item.turn)).toEqual([2, 3]);
  });

  it("gates entries, not exits, on the decider's signal and reports it", async () => {
    const decider = new ScriptedDecider([
      {
        decisions: [{ instrument: "gold", action: "buy", confidence: 0.9 }],
        signal: 0.9,
      },
      {
        decisions: [
          { instrument: "bitcoin", action: "buy", confidence: 0.9 },
          { instrument: "gold", action: "close", confidence: 0.9 },
        ],
        signal: 0.2,
      },
    ]);
    const { engine, events } = setup(
      [
        tick(1000, "gold", 200),
        tick(1000, "bitcoin", 50_000),
        seg(9000),
        seg(50_000),
      ],
      { decider }
    );
    await engine.run();
    expect(types(events)).toEqual([
      "start",
      "decision",
      "fill",
      "snapshot",
      "decision",
      "reject",
      "fill",
      "snapshot",
      "end",
    ]);
    expect(events[5]).toMatchObject({
      type: "reject",
      instrument: "bitcoin",
      reason: "no market-moving statement (signal 0.20 below 0.50)",
    });
    expect(events[6]).toMatchObject({
      type: "fill",
      action: "close",
      instrument: "gold",
    });
  });

  it("keeps no context at all with a zero window", async () => {
    const decider = new ScriptedDecider([]);
    const { engine } = setup([seg(9000, "a"), seg(50_000, "b")], {
      decider,
      contextSeconds: 0,
    });
    await engine.run();
    expect(decider.inputs[1]?.context).toEqual([]);
  });

  it("clamps and dedupes decisions from any decider", async () => {
    const decider = new ScriptedDecider([
      {
        decisions: [
          { instrument: "gold", action: "buy", confidence: 7 },
          { instrument: "gold", action: "close", confidence: 0.9 },
        ],
      },
    ]);
    const { engine, events } = setup([tick(1000, "gold", 200), seg(9000)], {
      decider,
    });
    await engine.run();
    expect(types(events)).toEqual([
      "start",
      "decision",
      "fill",
      "snapshot",
      "end",
    ]);
    expect(events[1]).toMatchObject({
      decisions: [{ instrument: "gold", action: "buy", confidence: 1 }],
    });
  });

  it("caps the pending buffer by line count as well as characters", async () => {
    const decider = new ScriptedDecider([]);
    const many = Array.from({ length: 6 }, (_, i) => seg(1000 + i, `l${i}`));
    const { engine, lines } = setup([...many, tick(40_000, "gold", 200)], {
      decider,
      maxBufferSegments: 4,
    });
    await engine.run();
    expect(decider.inputs[0]?.segments.map((segment) => segment.text)).toEqual([
      "l2",
      "l3",
      "l4",
      "l5",
    ]);
    expect(
      lines.some(
        (entry) =>
          entry.message === "transcript buffer full, dropped oldest lines"
      )
    ).toBe(true);
  });

  it("takes periodic snapshots between turns", async () => {
    const { engine, events } = setup(
      [
        tick(1000, "gold", 200),
        tick(12_000, "gold", 201),
        tick(25_000, "gold", 202),
      ],
      { snapshotIntervalMs: 10_000 }
    );
    await engine.run();
    expect(types(events)).toEqual(["start", "snapshot", "snapshot", "end"]);
    expect(events[1]).toMatchObject({ time: "2026-09-26T12:00:10.000Z" });
    expect(events[2]).toMatchObject({ time: "2026-09-26T12:00:20.000Z" });
  });
});
