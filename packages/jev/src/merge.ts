// Combines several async sources into one. Sources are factories that take
// an abort signal, because a generator blocked in `await` cannot be stopped
// from outside any other way; each source is expected to end once the signal
// aborts, as the transcriber and the price feed do.

import { Channel } from "@repo/alpaca/channel";
import { setTimeout as sleep } from "node:timers/promises";

type Source<T> = (signal: AbortSignal) => AsyncIterable<T>;

type MergeOptions = {
  /**
   * Index of the source whose end ends the merged stream, even while the
   * others run on. Without it the stream ends when every source has ended.
   */
  primary?: number;
};

/**
 * Yields values from every source as they arrive. The first failure aborts
 * the other sources and is thrown once the buffered values are consumed.
 */
const merge = <T>(
  sources: readonly Source<T>[],
  options: MergeOptions = {}
): Source<T> =>
  async function* (signal) {
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    if (signal.aborted) {
      controller.abort();
    }
    signal.addEventListener("abort", onAbort, { once: true });

    const channel = new Channel<T>();
    const pumps = sources.map(async (source, index) => {
      for await (const value of source(controller.signal)) {
        channel.push(value);
      }
      if (index === options.primary) {
        channel.end();
      }
    });
    void Promise.all(pumps).then(
      () => {
        channel.end();
      },
      (error: unknown) => {
        controller.abort();
        channel.fail(error);
      }
    );

    try {
      yield* channel;
    } finally {
      controller.abort();
      signal.removeEventListener("abort", onAbort);
      await Promise.allSettled(pumps);
    }
  };

/** Yields every `ms` milliseconds until the signal aborts. */
const interval = (ms: number): Source<void> =>
  async function* (signal) {
    while (!signal.aborted) {
      try {
        await sleep(ms, undefined, { signal });
      } catch {
        return;
      }
      yield;
    }
  };

/** Applies `fn` to every value of `source`. */
const mapSource = <T, U>(source: Source<T>, fn: (value: T) => U): Source<U> =>
  async function* (signal) {
    for await (const value of source(signal)) {
      yield fn(value);
    }
  };

export { interval, mapSource, merge };
export type { MergeOptions, Source };
