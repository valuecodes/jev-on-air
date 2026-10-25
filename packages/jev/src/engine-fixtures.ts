// Timelines and a ready-made engine for the engine tests: a fast replay on a
// virtual clock, a scripted decider and an in-memory ledger.
import type { PriceTick } from "@repo/alpaca/prices";
import { createTestLogger } from "@repo/logger/testing";

import { ScriptedDecider } from "./decider";
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

const setup = (timeline: Timed<EngineEvent>[], options: Setup = {}) => {
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
};

const types = (events: JevEvent[]) => events.map((event) => event.type);

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

export { buy, history, line, seg, setup, startAt, tick, types };
