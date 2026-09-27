import { describe, expect, it } from "vitest";

import { interval, mapSource, merge } from "./merge";
import type { Source } from "./merge";

function fromArray<T>(values: readonly T[]): Source<T> {
  return async function* () {
    for (const value of values) {
      await Promise.resolve();
      yield value;
    }
  };
}

/** Yields nothing and ends only when aborted, like a quiet live feed. */
function untilAborted<T>(): Source<T> {
  return async function* (signal) {
    yield* [];
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  };
}

async function collect<T>(
  source: Source<T>,
  signal = new AbortController().signal
): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source(signal)) values.push(value);
  return values;
}

describe("merge", () => {
  it("yields every value of every source and ends when all end", async () => {
    const values = await collect(
      merge([fromArray([1, 2, 3]), fromArray([10, 20])])
    );
    expect(values.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 10, 20]);
    expect(values.filter((v) => v < 10)).toEqual([1, 2, 3]);
  });

  it("ends when the primary source ends, even with others still open", async () => {
    let siblingAborted = false;
    const sibling: Source<number> = async function* (signal) {
      yield 100;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      siblingAborted = true;
    };
    const values = await collect(
      merge([fromArray([1, 2]), sibling], { primary: 0 })
    );
    expect(values.filter((v) => v < 100)).toEqual([1, 2]);
    expect(siblingAborted).toBe(true);
  });

  it("throws the first failure and aborts the others", async () => {
    const failing: Source<number> = async function* () {
      yield* [];
      await Promise.resolve();
      throw new Error("feed died");
    };
    let aborted = false;
    const quiet: Source<number> = async function* (signal) {
      yield* [];
      if (signal.aborted) return;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      aborted = true;
    };
    await expect(collect(merge([quiet, failing]))).rejects.toThrow("feed died");
    expect(aborted).toBe(true);
  });

  it("ends when the caller aborts", async () => {
    const controller = new AbortController();
    const pending = collect(
      merge([untilAborted<number>(), untilAborted<number>()]),
      controller.signal
    );
    controller.abort();
    expect(await pending).toEqual([]);
  });
});

describe("interval", () => {
  it("ticks until aborted", async () => {
    const controller = new AbortController();
    const ticks: number[] = [];
    for await (const _ of mapSource(interval(1), () => 1)(controller.signal)) {
      ticks.push(_);
      if (ticks.length === 3) controller.abort();
    }
    expect(ticks).toEqual([1, 1, 1]);
  });
});
