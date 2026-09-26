import { describe, expect, it } from "vitest";

import { Channel } from "./channel";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe("Channel", () => {
  it("yields values pushed before and after the consumer waits", async () => {
    const channel = new Channel<number>();
    channel.push(1);
    const values = collect(channel);
    await Promise.resolve();
    channel.push(2);
    channel.end();
    channel.push(3);
    expect(await values).toEqual([1, 2]);
  });

  it("throws after draining when failed", async () => {
    const channel = new Channel<number>();
    const seen: number[] = [];
    channel.push(1);
    channel.fail(new Error("boom"));
    await expect(async () => {
      for await (const value of channel) seen.push(value);
    }).rejects.toThrow("boom");
    expect(seen).toEqual([1]);
  });

  it("ignores failures after it ended", async () => {
    const channel = new Channel<number>();
    channel.end();
    channel.fail(new Error("late"));
    expect(await collect(channel)).toEqual([]);
  });
});
