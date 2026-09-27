import { INSTRUMENTS } from "@repo/alpaca/instruments";
import { describe, expect, it } from "vitest";

import {
  INSTRUMENT_IDS,
  normalizeTurnOutput,
  TurnOutputSchema,
} from "./schema";

describe("INSTRUMENT_IDS", () => {
  it("matches the instruments the price feed knows", () => {
    expect([...INSTRUMENT_IDS]).toEqual(INSTRUMENTS.map((i) => i.id));
  });
});

describe("TurnOutputSchema", () => {
  it("accepts a hold and rejects unknown instruments", () => {
    expect(TurnOutputSchema.parse({ decisions: [] })).toEqual({
      decisions: [],
    });
    expect(() =>
      TurnOutputSchema.parse({
        decisions: [{ instrument: "silver", action: "buy", confidence: 1 }],
      })
    ).toThrow();
  });
});

describe("normalizeTurnOutput", () => {
  it("clamps confidence and keeps the most confident decision per instrument", () => {
    const output = normalizeTurnOutput({
      decisions: [
        { instrument: "gold", action: "buy", confidence: 0.5 },
        { instrument: "oil", action: "short", confidence: 1.7 },
        {
          instrument: "gold",
          action: "close",
          confidence: 0.9,
        },
        { instrument: "oil", action: "buy", confidence: -1 },
        { instrument: "sp500", action: "buy", confidence: NaN },
      ],
      signal: 0.8,
    });
    expect(output).toEqual({
      decisions: [
        {
          instrument: "gold",
          action: "close",
          confidence: 0.9,
        },
        { instrument: "oil", action: "short", confidence: 1 },
        { instrument: "sp500", action: "buy", confidence: 0 },
      ],
      signal: 0.8,
    });
  });
});
