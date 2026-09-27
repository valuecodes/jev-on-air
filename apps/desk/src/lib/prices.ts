// Turns the CLI's tick file into chart points. Quotes arrive many times a
// second, so only the last price per instrument per bucket is kept.
import { parseTickLine } from "@repo/jev/replay";

import type { PricePoint } from "./types";

/**
 * Parses tick lines and keeps the last price per instrument per `bucketMs`,
 * in time order. Lines that are not ticks are counted, not thrown.
 */
export function downsample(
  lines: string[],
  bucketMs = 1000
): { points: PricePoint[]; invalid: number } {
  const last = new Map<string, PricePoint>();
  let invalid = 0;
  for (const line of lines) {
    let tick;
    try {
      tick = parseTickLine(line);
    } catch {
      invalid++;
      continue;
    }
    const t = Math.floor(Date.parse(tick.timestamp) / bucketMs) * bucketMs;
    // Re-inserting moves the key to the end, but the sort below orders anyway.
    last.set(`${tick.instrument}:${t}`, {
      instrument: tick.instrument,
      t,
      price: tick.price,
    });
  }
  const points = [...last.values()].sort((a, b) => a.t - b.t);
  return { points, invalid };
}
