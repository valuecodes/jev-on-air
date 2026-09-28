import type { PriceTick } from "@repo/alpaca/prices";
import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it } from "vitest";

import { DeciderError, ScriptedDecider } from "./decider";
import type { Decider, DecideResult } from "./decider";
import { Engine } from "./engine";
import type { EngineEvent, EngineOptions } from "./engine";
import type { JevEvent } from "./ledger";
import type { Source } from "./merge";
import { fractionOfEquity, Portfolio } from "./portfolio";
import { fast } from "./replay";
import type { Timed } from "./replay";
import type { TurnOutput } from "./schema";

const startAt = Date.parse("2026-09-26T12:00:00.000Z");
const line = "x".repeat(50);

const seg = (at: number, text = line): Timed<EngineEvent> => ({
  at,
  value: {
    kind: "segment",
    segment: { start: at / 1000 - 8, end: at / 1000, text },
  },
});

const tick = (
  at: number,
  instrument: PriceTick["instrument"],
  price: number
): Timed<EngineEvent> => ({
  at,
  value: {
    kind: "tick",
    tick: {
      instrument,
      name: instrument,
      symbol: instrument,
      source: "trade",
      price,
      timestamp: new Date(startAt + at).toISOString(),
    },
  },
});

const buy = (
  instrument: PriceTick["instrument"],
  confidence = 0.9
): TurnOutput => ({
  decisions: [{ instrument, action: "buy", confidence }],
});

type Setup = Partial<Omit<EngineOptions, "events" | "onEvent">> & {
  events?: Source<EngineEvent>;
  onEvent?: EngineOptions["onEvent"];
};

function setup(timeline: Timed<EngineEvent>[], options: Setup = {}) {
  const { logger, lines } = createTestLogger();
  const replay = fast([timeline], { heartbeatMs: 1000, startAt });
  const events: JevEvent[] = [];
  const engine = new Engine(logger, {
    events: replay.source,
    clock: replay.clock,
    decider: new ScriptedDecider([]),
    portfolio: new Portfolio({ cash: 100_000, sizer: fractionOfEquity(0.1) }),
    trigger: { minChars: 40, maxWaitMs: 30_000 },
    snapshotIntervalMs: 0,
    awaitDecisions: true,
    onEvent: (event) => {
      events.push(event);
    },
    run: "run-1",
    source: "test",
    model: "scripted",
    size: 0.1,
    resumed: false,
    ...options,
  });
  return { engine, events, lines };
}

const types = (events: JevEvent[]) => events.map((event) => event.type);

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

  it("keeps the lines after a retryable failure and resends them after the backoff", async () => {
    const inputs: unknown[] = [];
    let failed = false;
    const decider: Decider = {
      decide: (input) => {
        inputs.push(input);
        if (!failed) {
          failed = true;
          return Promise.reject(new DeciderError("rate_limit", "429"));
        }
        return Promise.resolve({ output: { decisions: [] }, latencyMs: 0 });
      },
    };
    const { engine, events } = setup(
      [seg(9000), seg(20_000, "more"), tick(45_000, "gold", 200)],
      { decider }
    );
    await engine.run();
    expect(types(events)).toEqual([
      "start",
      "error",
      "decision",
      "snapshot",
      "end",
    ]);
    expect(events[1]).toMatchObject({
      type: "error",
      kind: "rate_limit",
      retryable: true,
      turn: 1,
    });
    expect(events[2]).toMatchObject({
      type: "decision",
      turn: 2,
      time: "2026-09-26T12:00:39.000Z",
      segments: 2,
    });
  });

  it("waits an interval between failures that will not get better and drops the lines after three", async () => {
    let calls = 0;
    const decider: Decider = {
      decide: () => {
        calls += 1;
        return Promise.reject(new DeciderError("unparseable", "no"));
      },
    };
    const { engine, events, lines } = setup(
      [seg(9000), tick(100_000, "gold", 200)],
      { decider }
    );
    await engine.run();
    expect(calls).toBe(3);
    expect(types(events)).toEqual(["start", "error", "error", "error", "end"]);
    expect(events.slice(1, 4).map((event) => event.time)).toEqual([
      "2026-09-26T12:00:09.000Z",
      "2026-09-26T12:00:39.000Z",
      "2026-09-26T12:01:09.000Z",
    ]);
    expect(
      lines.some((entry) =>
        String(entry.message).includes("dropping pending transcript")
      )
    ).toBe(true);
  });

  it("ends the run on an API error that will not recover", async () => {
    const decider: Decider = {
      decide: () => Promise.reject(new DeciderError("api", "401 bad key")),
    };
    const { engine, events } = setup([seg(9000), tick(100_000, "gold", 200)], {
      decider,
    });
    await expect(engine.run()).rejects.toMatchObject({ kind: "api" });
    expect(types(events)).toEqual(["start", "error"]);
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

  it("fails the run on an unexpected decider error or a failing event sink", async () => {
    const broken: Decider = { decide: () => Promise.reject(new Error("boom")) };
    const { engine } = setup([seg(9000)], { decider: broken });
    await expect(engine.run()).rejects.toThrow("boom");

    const { engine: engine2 } = setup([tick(1000, "gold", 200), seg(9000)], {
      decider: new ScriptedDecider([buy("gold")]),
      onEvent: (event) => {
        if (event.type === "fill") throw new Error("disk full");
      },
    });
    await expect(engine2.run()).rejects.toThrow("disk full");
  });

  it("ends cleanly on abort, cancelling the call in flight", async () => {
    const controller = new AbortController();
    let sawAbort = false;
    const decider: Decider = {
      decide: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            sawAbort = true;
            reject(new DeciderError("aborted", "aborted"));
          });
        }),
    };
    const source: Source<EngineEvent> = async function* (signal) {
      yield seg(1000).value;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    };
    const { engine, events } = setup([], {
      events: source,
      clock: undefined,
      decider,
      awaitDecisions: false,
    });
    const run = engine.run(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await run;
    expect(sawAbort).toBe(true);
    expect(types(events)).toEqual(["start", "end"]);
    expect(events[1]).toMatchObject({ type: "end", reason: "aborted" });
  });

  it("still cancels the final flush when aborted after the source ended", async () => {
    const controller = new AbortController();
    let sawAbort = false;
    const decider: Decider = {
      decide: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            sawAbort = true;
            reject(new DeciderError("aborted", "aborted"));
          });
        }),
    };
    const { engine, events } = setup([seg(1000, "hi")], {
      decider,
      clock: undefined,
    });
    const run = engine.run(controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await run;
    expect(sawAbort).toBe(true);
    expect(types(events)).toEqual(["start", "end"]);
    expect(events[1]).toMatchObject({ type: "end", reason: "aborted" });
  });

  it("applies an answer that arrives after the stream ended", async () => {
    let resolve: ((result: DecideResult) => void) | undefined;
    const decider: Decider = {
      decide: () =>
        new Promise((done) => {
          resolve = done;
        }),
    };
    const { engine, events } = setup([tick(1000, "gold", 200), seg(9000)], {
      decider,
      awaitDecisions: false,
    });
    const run = engine.run();
    await new Promise((done) => setTimeout(done, 10));
    resolve?.({ output: buy("gold"), latencyMs: 5 });
    await run;
    expect(types(events)).toEqual([
      "start",
      "decision",
      "fill",
      "snapshot",
      "end",
    ]);
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

/** Twenty 1-minute bars of gold ending at `startAt`, wiggling ±0.1 %. */
const history = (): PriceTick[] =>
  Array.from({ length: 20 }, (_, index) => ({
    instrument: "gold",
    name: "Gold",
    symbol: "GLD",
    source: "trade",
    price: index % 2 === 0 ? 100 : 100.1,
    size: 100,
    timestamp: new Date(startAt - (19 - index) * 60_000).toISOString(),
  }));

describe("Engine market rules", () => {
  it("shows the model how markets move and records it", async () => {
    const decider = new ScriptedDecider([]);
    const { engine, events } = setup([tick(1000, "gold", 100), seg(9000)], {
      decider,
      marketHistory: history(),
    });
    await engine.run();
    const market = decider.inputs[0]?.prices.find(
      (view) => view.instrument === "gold"
    )?.market;
    expect(market?.volatility).toBeGreaterThan(0);
    expect(market?.relativeVolume).toBeDefined();
    expect(events[0]).toMatchObject({
      type: "start",
      strategy: { sizing: "fixed", maxChaseZ: 3, stopZ: 0, takeProfitZ: 0 },
    });
    expect(events[1]).toMatchObject({
      type: "decision",
      market: { gold: { volatility: market?.volatility }, oil: null },
    });
  });

  it("builds features on its own clock when ticks carry older exchange times", async () => {
    // A replay without an audio start: its clock starts now, the recording
    // was made a day earlier.
    const dayAgo = 24 * 60 * 60_000;
    const recorded = history().map((item, index) => ({
      at: (index + 1) * 60_000,
      value: {
        kind: "tick" as const,
        tick: {
          ...item,
          timestamp: new Date(
            startAt - dayAgo + (index + 1) * 60_000
          ).toISOString(),
        },
      },
    }));
    const decider = new ScriptedDecider([]);
    const { engine } = setup([...recorded, seg(20 * 60_000 + 9000)], {
      decider,
    });
    await engine.run();
    expect(
      decider.inputs[0]?.prices.find((view) => view.instrument === "gold")
        ?.market?.volatility
    ).toBeGreaterThan(0);
  });

  it("rejects an entry chasing a move that already happened, not one against it", async () => {
    const decider = new ScriptedDecider([
      {
        decisions: [
          { instrument: "gold", action: "buy", confidence: 0.9 },
          { instrument: "bitcoin", action: "buy", confidence: 0.9 },
        ],
      },
    ]);
    const { engine, events } = setup(
      [tick(1000, "gold", 102), tick(1000, "bitcoin", 50_000), seg(9000)],
      { decider, marketHistory: history() }
    );
    await engine.run();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "reject",
        instrument: "gold",
        reason: expect.stringMatching(
          /already moved .* up; likely priced in/
        ) as unknown,
      })
    );
    // Bitcoin has no history, so nothing to chase.
    expect(events).toContainEqual(
      expect.objectContaining({ type: "fill", instrument: "bitcoin" })
    );

    const shorts = new ScriptedDecider([
      { decisions: [{ instrument: "gold", action: "short", confidence: 0.9 }] },
    ]);
    const against = setup([tick(1000, "gold", 102), seg(9000)], {
      decider: shorts,
      marketHistory: history(),
    });
    await against.engine.run();
    expect(against.events).toContainEqual(
      expect.objectContaining({ type: "fill", action: "short" })
    );

    const off = setup([tick(1000, "gold", 102), seg(9000)], {
      decider: new ScriptedDecider([buy("gold")]),
      marketHistory: history(),
      maxChaseZ: 0,
    });
    await off.engine.run();
    expect(off.events).toContainEqual(
      expect.objectContaining({ type: "fill", action: "buy" })
    );
  });

  it("stops out a losing position and takes profit on a winning one", async () => {
    for (const [price, exit] of [
      [98, "stop"],
      [102, "take-profit"],
    ] as const) {
      const decider = new ScriptedDecider([buy("gold")]);
      const { engine, events } = setup(
        [tick(1000, "gold", 100), seg(9000), tick(20_000, "gold", price)],
        { decider, marketHistory: history(), stopZ: 3, takeProfitZ: 3 }
      );
      const final = await engine.run();
      const entry = events.find(
        (event) => event.type === "fill" && event.action === "buy"
      );
      expect(entry).toMatchObject({
        volatility: expect.any(Number) as unknown,
      });
      const closed = events.find(
        (event) => event.type === "fill" && event.action === "close"
      );
      expect(closed).toMatchObject({
        type: "fill",
        turn: null,
        confidence: null,
        exit,
        price,
      });
      if (closed?.type !== "fill") throw new Error("no exit");
      expect(Math.abs(closed.exitThresholdPct ?? 0)).toBeGreaterThan(0);
      expect(events[events.indexOf(closed) + 1]?.type).toBe("snapshot");
      expect(final.positions).toEqual([]);
    }
  });

  it("leaves positions alone while stops are off or the move is small", async () => {
    const { engine, events } = setup(
      [tick(1000, "gold", 100), seg(9000), tick(20_000, "gold", 99.9)],
      {
        decider: new ScriptedDecider([buy("gold")]),
        marketHistory: history(),
        stopZ: 3,
      }
    );
    const final = await engine.run();
    expect(events.filter((event) => event.type === "fill")).toHaveLength(1);
    expect(final.positions).toHaveLength(1);
  });

  it("rejects a decision about a position a stop closed while the model was deciding", async () => {
    let resolve: ((result: DecideResult) => void) | undefined;
    const decider: Decider = {
      decide: () =>
        new Promise((done) => {
          resolve = done;
        }),
    };
    const portfolio = Portfolio.fromState(
      {
        version: 1,
        cash: 90_000,
        realized: 0,
        positions: { gold: { side: "long", quantity: 100, avgPrice: 100 } },
        updatedAt: "t",
      },
      { sizer: fractionOfEquity(0.1) }
    );
    const { engine, events } = setup(
      [tick(1000, "gold", 100), seg(9000), tick(10_000, "gold", 98)],
      {
        decider,
        portfolio,
        marketHistory: history(),
        stopZ: 3,
        awaitDecisions: false,
        onEvent: (event) => {
          events.push(event);
          // The model answers only once the stop has already fired.
          if (event.type === "fill" && event.exit === "stop")
            setTimeout(() => {
              resolve?.({ output: buy("gold"), latencyMs: 5 });
            }, 0);
        },
      }
    );
    await engine.run();
    expect(types(events)).toEqual([
      "start",
      "fill",
      "snapshot",
      "decision",
      "reject",
      "snapshot",
      "end",
    ]);
    expect(events[4]).toMatchObject({
      type: "reject",
      reason: "position was closed by a stop while deciding",
    });
  });
});
