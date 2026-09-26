import { describe, expect, it } from "vitest";

import {
  authMessage,
  isFatalError,
  parseFrame,
  subscribeMessage,
} from "./protocol";

describe("messages", () => {
  it("builds auth and subscribe messages", () => {
    expect(JSON.parse(authMessage({ keyId: "k", secretKey: "s" }))).toEqual({
      action: "auth",
      key: "k",
      secret: "s",
    });
    expect(JSON.parse(subscribeMessage(["SPY", "GLD"]))).toEqual({
      action: "subscribe",
      trades: ["SPY", "GLD"],
      quotes: ["SPY", "GLD"],
    });
  });
});

describe("parseFrame", () => {
  it("parses control messages", () => {
    expect(
      parseFrame(
        JSON.stringify([
          { T: "success", msg: "connected" },
          { T: "success", msg: "authenticated" },
          { T: "subscription", trades: ["SPY"], quotes: [] },
          { T: "error", code: 402, msg: "auth failed" },
        ])
      )
    ).toEqual([
      { type: "connected" },
      { type: "authenticated" },
      { type: "subscription", trades: ["SPY"], quotes: [] },
      { type: "error", code: 402, message: "auth failed" },
    ]);
  });

  it("parses stock and crypto trades", () => {
    expect(
      parseFrame(
        JSON.stringify([
          {
            T: "t",
            S: "SPY",
            i: 52983525029461,
            x: "V",
            p: 512.34,
            s: 100,
            c: ["@"],
            t: "2026-09-25T14:31:07.123456789Z",
            z: "B",
          },
          {
            T: "t",
            S: "BTC/USD",
            p: 64000.5,
            s: 0.0012,
            t: "2026-09-25T14:31:08Z",
            i: 1,
            tks: "B",
          },
        ])
      )
    ).toEqual([
      {
        type: "trade",
        trade: {
          symbol: "SPY",
          price: 512.34,
          size: 100,
          timestamp: "2026-09-25T14:31:07.123456789Z",
        },
      },
      {
        type: "trade",
        trade: {
          symbol: "BTC/USD",
          price: 64000.5,
          size: 0.0012,
          timestamp: "2026-09-25T14:31:08Z",
        },
      },
    ]);
  });

  it("parses quotes", () => {
    expect(
      parseFrame(
        JSON.stringify([
          {
            T: "q",
            S: "BTC/USD",
            bp: 63999.5,
            bs: 0.5,
            ap: 64001,
            as: 0.25,
            t: "2026-09-25T14:31:08Z",
          },
        ])
      )
    ).toEqual([
      {
        type: "quote",
        quote: {
          symbol: "BTC/USD",
          bidPrice: 63999.5,
          bidSize: 0.5,
          askPrice: 64001,
          askSize: 0.25,
          timestamp: "2026-09-25T14:31:08Z",
        },
      },
    ]);
  });

  it("drops messages it does not use or cannot read", () => {
    expect(
      parseFrame(
        JSON.stringify([
          { T: "b", S: "SPY", o: 1, c: 2 },
          { T: "q", S: "SPY", bp: 1, ap: 2 },
          { T: "t", S: "SPY", p: "512" },
          { T: "success", msg: "something new" },
          { T: "error", msg: "no code" },
          "noise",
          null,
        ])
      )
    ).toEqual([]);
  });

  it("throws on frames that are not arrays", () => {
    expect(() => parseFrame('{"T":"t"}')).toThrow(/not an Alpaca frame/);
    expect(() => parseFrame("not json")).toThrow();
  });
});

describe("isFatalError", () => {
  it("does not retry auth, limit and subscription errors", () => {
    for (const code of [400, 401, 402, 405, 406, 409, 410])
      expect(isFatalError(code)).toBe(true);
  });

  it("retries transient errors", () => {
    for (const code of [403, 404, 407, 500])
      expect(isFatalError(code)).toBe(false);
  });
});
