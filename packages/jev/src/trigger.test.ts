import { describe, expect, it } from "vitest";

import { shouldEvaluate } from "./trigger";

const options = { minChars: 400, maxWaitMs: 30_000 };
const idle = {
  pendingChars: 0,
  pendingSegments: 0,
  msSinceLastEvaluation: 0,
  inFlight: false,
};

describe("shouldEvaluate", () => {
  it("fires on enough text or enough waiting, never while a call is out", () => {
    expect(shouldEvaluate(options, idle)).toBe(false);
    expect(
      shouldEvaluate(options, {
        ...idle,
        pendingSegments: 1,
        pendingChars: 100,
      })
    ).toBe(false);
    expect(
      shouldEvaluate(options, {
        ...idle,
        pendingSegments: 3,
        pendingChars: 400,
      })
    ).toBe(true);
    expect(
      shouldEvaluate(options, {
        ...idle,
        pendingSegments: 1,
        pendingChars: 10,
        msSinceLastEvaluation: 30_000,
      })
    ).toBe(true);
    expect(
      shouldEvaluate(options, {
        ...idle,
        pendingSegments: 0,
        msSinceLastEvaluation: 90_000,
      })
    ).toBe(false);
    expect(
      shouldEvaluate(options, {
        ...idle,
        pendingSegments: 9,
        pendingChars: 9000,
        inFlight: true,
      })
    ).toBe(false);
  });
});
