import { describe, expect, it } from "vitest";

import { formatEvent } from "./ledger";
import type { JevEvent } from "./ledger";

const base = {
  run: "r",
  time: "2026-09-26T14:31:07.123Z",
  audioTime: 12,
  turn: 4,
};
const snapshot = {
  cash: 90_000,
  equity: 100_119.3,
  realized: -5,
  unrealized: 119.3,
  grossExposure: 10_119.3,
  positions: [
    {
      instrument: "gold" as const,
      side: "long" as const,
      quantity: 41.1354,
      avgPrice: 243.1,
      price: 246,
      unrealizedPnl: 119.3,
    },
  ],
};

describe("formatEvent", () => {
  it("renders one line per event type", () => {
    const events: JevEvent[] = [
      {
        ...base,
        turn: null,
        type: "start",
        source: "youtube:abc",
        model: "jev-latest",
        cash: 100_000,
        equity: 100_000,
        size: 0.1,
        resumed: true,
      },
      {
        ...base,
        type: "decision",
        decisions: [
          {
            instrument: "gold",
            action: "buy",
            confidence: 0.9,
            probabilities: { buy: 0.62, hold: 0.3, short: 0.08 },
          },
        ],
        signal: 0.91,
        model: "jev-1.13.0",
        latencyMs: 1200,
        segments: 3,
        usage: null,
      },
      {
        ...base,
        type: "decision",
        decisions: [],
        signal: 0.12,
        model: null,
        latencyMs: 0,
        segments: 1,
        usage: null,
      },
      {
        ...base,
        type: "fill",
        confidence: 0.9,
        instrument: "gold",
        action: "buy",
        side: "long",
        quantity: 41.1354,
        price: 243.1,
        notional: 10_000,
        realizedPnl: 0,
        position: undefined,
        cash: 90_000,
      },
      {
        ...base,
        type: "fill",
        confidence: 0.9,
        instrument: "gold",
        action: "close",
        side: "long",
        quantity: 41.1354,
        price: 246,
        notional: 10_119.3,
        realizedPnl: 119.3,
        position: undefined,
        cash: 100_119.3,
      },
      {
        ...base,
        type: "reject",
        instrument: "sp500",
        action: "buy",
        confidence: 0.7,
        reason: "no price yet for sp500",
      },
      { ...base, turn: null, type: "snapshot", ...snapshot },
      {
        ...base,
        type: "error",
        kind: "rate_limit",
        message: "429",
        retryable: true,
      },
      { ...base, turn: null, type: "end", reason: "aborted", ...snapshot },
    ];
    expect(events.map(formatEvent)).toEqual([
      "14:31:07  start     youtube:abc  model jev-latest  cash 100000.00  equity 100000.00  size 0.1  (resumed)",
      "14:31:07  decision  #4 buy gold 0.90 (buy 0.62, hold 0.30)  signal 0.91",
      "14:31:07  decision  #4 hold  signal 0.12",
      "14:31:07  fill      #4 buy gold 41.1354 @ 243.10  10000.00  cash 90000.00",
      "14:31:07  fill      #4 close gold 41.1354 @ 246.00  10119.30  realized +119.30  cash 100119.30",
      "14:31:07  reject    #4 buy sp500 — no price yet for sp500",
      "14:31:07  snapshot  equity 100119.30  cash 90000.00  realized -5.00  gold L 41.1354@243.10 (+119.30)",
      "14:31:07  error     #4 rate_limit (will retry) — 429",
      "14:31:07  end       aborted  equity 100119.30  cash 90000.00  realized -5.00  gold L 41.1354@243.10 (+119.30)",
    ]);
  });
});
