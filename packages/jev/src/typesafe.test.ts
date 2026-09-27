import { createTestLogger } from "@repo/logger/testing";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";

import { DeciderError } from "./decider";
import type { TurnInput } from "./questions";
import { interpretAnswers, toDeciderError, TypeSafeDecider } from "./typesafe";
import type { TurnAnswers } from "./typesafe";

const input: TurnInput = {
  turn: 1,
  now: "2026-09-26T12:00:00.000Z",
  segments: [{ start: 0, end: 8, text: "Tariffs on steel double tomorrow." }],
  context: [],
  audioEnd: 8,
  prices: [
    {
      instrument: "gold",
      name: "Gold",
      symbol: "GLD",
      price: 243.1,
      ageSeconds: 1,
    },
    {
      instrument: "bitcoin",
      name: "Bitcoin",
      symbol: "BTC/USD",
      price: 64000,
      ageSeconds: 0,
    },
    {
      instrument: "sp500",
      name: "S&P 500",
      symbol: "SPY",
      price: 512,
      ageSeconds: 1,
    },
    { instrument: "oil", name: "Oil", symbol: "USO", price: 71, ageSeconds: 1 },
  ],
  snapshot: {
    cash: 100_000,
    equity: 100_000,
    realized: 0,
    unrealized: 0,
    grossExposure: 0,
    positions: [],
  },
  feedback: [],
};

const choiceOf = (choice: string, probabilities: Record<string, number>) => ({
  type: "choice" as const,
  choice,
  confidence: probabilities[choice] ?? 0,
  probabilities,
});
const hold = choiceOf("hold", { hold: 0.9, buy: 0.05, short: 0.05 });

const answers: TurnAnswers = {
  signal: { type: "noul", noul: 0.93 },
  gold: choiceOf("buy", { hold: 0.2, buy: 0.75, short: 0.05 }),
  bitcoin: hold,
  sp500: hold,
  oil: choiceOf("short", { hold: 0.55, buy: 0.05, short: 0.4 }),
};

const meta = {
  model: "jev-1.13.0",
  usage: { input_tokens: 900, output_tokens: 12 },
  latencyMs: 210,
};
const instruments = ["gold", "bitcoin", "sp500", "oil"] as const;

function fakeClient(replies: unknown[], status = 200) {
  const requests: {
    url: string;
    headers: Headers;
    body: Record<string, unknown>;
  }[] = [];
  const client = new TypeSafeClient({
    apiKey: "ts-test",
    retry: { maxRetries: 0 },
    logLevel: "off",
    fetch: (url, init) => {
      requests.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
      });
      return Promise.resolve(
        new Response(JSON.stringify(replies.shift()), {
          status,
          headers: { "content-type": "application/json" },
        })
      );
    },
  });
  return { client, requests };
}

describe("TypeSafeDecider", () => {
  it("sends the state and questions and maps the answers to decisions", async () => {
    const { client, requests } = fakeClient([
      {
        model: "jev-1.13.0",
        answers,
        usage: { input_tokens: 900, output_tokens: 12 },
      },
    ]);
    const { logger, lines } = createTestLogger();
    const decider = new TypeSafeDecider(logger, {
      client,
      model: "jev-preview",
    });

    const result = await decider.decide(input);
    expect(result.output).toEqual({
      decisions: [
        {
          instrument: "gold",
          action: "buy",
          confidence: 0.75,
          probabilities: { hold: 0.2, buy: 0.75, short: 0.05 },
        },
        {
          instrument: "oil",
          action: "short",
          confidence: 0.4,
          probabilities: { hold: 0.55, buy: 0.05, short: 0.4 },
        },
      ],
      signal: 0.93,
    });
    expect(result.model).toBe("jev-1.13.0");
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 12 });

    const [request] = requests;
    expect(request?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(request?.headers.get("authorization")).toBe("Bearer ts-test");
    expect(request?.body.model).toBe("jev-preview");
    expect(request?.body.state).toMatchObject({
      new_transcript: [
        { time: "00:00:00", text: "Tariffs on steel double tomorrow." },
      ],
    });
    const questions = request?.body.questions as Record<
      string,
      { type: string; criteria?: Record<string, unknown> }
    >;
    expect(Object.keys(questions).toSorted()).toEqual([
      "bitcoin",
      "gold",
      "oil",
      "signal",
      "sp500",
    ]);
    expect(questions.gold).toMatchObject({
      type: "choice",
      criteria: {
        hold: expect.anything() as unknown,
        buy: expect.anything() as unknown,
        short: expect.anything() as unknown,
      },
    });
    expect(lines.at(-1)).toMatchObject({
      message: "turn decided",
      signal: 0.93,
      decisions: 2,
      inputTokens: 900,
    });
  });

  it("maps HTTP failures onto decider errors", async () => {
    const { client } = fakeClient([{ error: "nope" }], 401);
    const decider = new TypeSafeDecider(createTestLogger().logger, { client });
    await expect(decider.decide(input)).rejects.toMatchObject({
      kind: "api",
      retryable: false,
    });
  });
});

describe("interpretAnswers", () => {
  it("passes the signal through with the decisions for the engine to gate", () => {
    const result = interpretAnswers(
      { ...answers, signal: { type: "noul", noul: 0.2 } },
      instruments,
      meta
    );
    expect(result.output.signal).toBe(0.2);
    expect(result.output.decisions).toHaveLength(2);
  });

  it("turns a malformed reply into a failure the engine can retry", () => {
    expect(() => interpretAnswers(undefined, instruments, meta)).toThrow(
      expect.objectContaining({
        kind: "unparseable",
        message: "reply carried no answers",
      })
    );
    const noOdds = {
      ...answers.gold,
      probabilities: null,
    } as unknown as TurnAnswers["gold"];
    expect(
      interpretAnswers({ ...answers, gold: noOdds }, instruments, meta).output
        .decisions[0]
    ).toEqual({
      instrument: "gold",
      action: "buy",
      confidence: 0.75,
      probabilities: {},
    });
    const noConfidence = {
      ...answers.gold,
      confidence: "high",
    } as unknown as TurnAnswers["gold"];
    expect(() =>
      interpretAnswers({ ...answers, gold: noConfidence }, instruments, meta)
    ).toThrow(
      expect.objectContaining({
        kind: "unparseable",
        message: "no confidence for gold",
      })
    );
    const strange = choiceOf("buy", { buy: 0.7, hedge: 0.3, hold: NaN });
    expect(
      interpretAnswers({ ...answers, gold: strange }, instruments, meta).output
        .decisions[0]?.probabilities
    ).toEqual({ buy: 0.7 });
    expect(
      interpretAnswers(answers, instruments, { ...meta, usage: undefined })
        .usage
    ).toBeUndefined();
  });

  it("trades without a gate when no signal answer came back", () => {
    const { signal: _signal, ...rest } = answers;
    expect(
      interpretAnswers(rest, instruments, meta).output.decisions
    ).toHaveLength(2);
  });

  it("rejects missing or unknown answers", () => {
    expect(() =>
      interpretAnswers({ ...answers, oil: undefined }, instruments, meta)
    ).toThrow(
      expect.objectContaining({
        kind: "unparseable",
        message: "no answer for oil",
      })
    );
    expect(() =>
      interpretAnswers(
        { ...answers, oil: choiceOf("hedge", { hedge: 1 }) },
        instruments,
        meta
      )
    ).toThrow(
      expect.objectContaining({
        kind: "unparseable",
        message: "unknown choice hedge for oil",
      })
    );
  });
});

describe("toDeciderError", () => {
  it("classifies SDK errors and passes others through", () => {
    const kind = (error: unknown) => {
      const mapped = toDeciderError(error);
      return mapped instanceof DeciderError
        ? [mapped.kind, mapped.retryable]
        : mapped;
    };
    const headers = new Headers();
    expect(
      kind(APIError.fromResponse(429, { error: "slow" }, headers))
    ).toEqual(["rate_limit", true]);
    expect(
      kind(APIError.fromResponse(503, { error: "down" }, headers))
    ).toEqual(["server", true]);
    expect(
      kind(APIError.fromResponse(529, { error: "overloaded" }, headers))
    ).toEqual(["server", true]);
    expect(kind(new APIConnectionError("reset"))).toEqual(["connection", true]);
    expect(kind(new APITimeoutError(1000))).toEqual(["connection", true]);
    expect(kind(new APIUserAbortError())).toEqual(["aborted", false]);
    expect(
      kind(APIError.fromResponse(401, { error: "bad key" }, headers))
    ).toEqual(["api", false]);
    expect(
      kind(APIError.fromResponse(422, { error: "bad question" }, headers))
    ).toEqual(["api", false]);
    expect(kind(new TypeSafeError("questions must not be empty"))).toEqual([
      "api",
      false,
    ]);
    const plain = new Error("plain");
    expect(toDeciderError(plain)).toBe(plain);
    const already = new DeciderError("server", "x");
    expect(toDeciderError(already)).toBe(already);
  });
});
