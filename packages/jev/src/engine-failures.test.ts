import { describe, expect, it } from "vitest";

import { DeciderError, ScriptedDecider } from "./decider";
import type { Decider, DecideResult } from "./decider";
import type { EngineEvent } from "./engine";
import { buy, seg, setup, tick, types } from "./engine-fixtures";
import type { Source } from "./merge";

/** Yields one line, then stays open until aborted, like a quiet live feed. */
const oneLineThenQuiet: Source<EngineEvent> = async function* (signal) {
  yield seg(1000).value;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
};

describe("Engine failures", () => {
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

  it("fails the run on an unexpected decider error or a failing event sink", async () => {
    const broken: Decider = { decide: () => Promise.reject(new Error("boom")) };
    const { engine } = setup([seg(9000)], { decider: broken });
    await expect(engine.run()).rejects.toThrow("boom");

    const { engine: engine2 } = setup([tick(1000, "gold", 200), seg(9000)], {
      decider: new ScriptedDecider([buy("gold")]),
      onEvent: (event) => {
        if (event.type === "fill") {
          throw new Error("disk full");
        }
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
    const { engine, events } = setup([], {
      events: oneLineThenQuiet,
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
});
