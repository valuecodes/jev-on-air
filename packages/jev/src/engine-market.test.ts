import { describe, expect, it } from "vitest";

import { ScriptedDecider } from "./decider";
import type { Decider, DecideResult } from "./decider";
import {
  buy,
  history,
  seg,
  setup,
  startAt,
  tick,
  types,
} from "./engine-fixtures";
import { fractionOfEquity, Portfolio } from "./portfolio";

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
      if (closed?.type !== "fill") {
        throw new Error("no exit");
      }
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
          if (event.type === "fill" && event.exit === "stop") {
            setTimeout(() => {
              resolve?.({ output: buy("gold"), latencyMs: 5 });
            }, 0);
          }
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
