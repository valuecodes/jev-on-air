import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it } from "vitest";

import { PriceHistory } from "./history";
import type { Fetch } from "./history";

const range = { from: "2026-09-16T18:25:00Z", to: "2026-09-16T18:28:00Z" };

const bar = (t: string, c: number, v = 10) => ({
  t,
  o: c,
  h: c,
  l: c,
  c,
  v,
  n: 1,
  vw: c,
});

function fakeFetch(pages: Record<string, unknown[]>) {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetchImpl: Fetch = (url, init) => {
    urls.push(url);
    headers.push(new Headers(init?.headers));
    const key = url.includes("/v2/stocks/") ? "stocks" : "crypto";
    const queue = pages[key] ?? [];
    const body = queue.shift() ?? { bars: {}, next_page_token: null };
    const status =
      typeof body === "object" && body !== null && "status" in body
        ? Number(body.status)
        : 200;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
    );
  };
  return { fetchImpl, urls, headers };
}

async function collect(history: PriceHistory) {
  const ticks = [];
  for await (const tick of history.ticks(range)) ticks.push(tick);
  return ticks;
}

describe("PriceHistory", () => {
  it("asks both endpoints, follows pages and merges bars into ticks at the bar's close", async () => {
    const { fetchImpl, urls, headers } = fakeFetch({
      stocks: [
        {
          bars: {
            GLD: [bar("2026-09-16T18:25:00Z", 243.1)],
            SPY: [bar("2026-09-16T18:25:00Z", 512)],
            AAPL: [bar("2026-09-16T18:25:00Z", 1)],
          },
          next_page_token: "p2",
        },
        {
          bars: { GLD: [bar("2026-09-16T18:26:00Z", 243.5, 7)] },
          next_page_token: null,
        },
      ],
      // A bar opening at `to` is outside the half-open window; an empty
      // token ends paging like a null one.
      crypto: [
        {
          bars: {
            "BTC/USD": [
              bar("2026-09-16T18:25:00Z", 64000),
              bar("2026-09-16T18:26:00Z", 64010),
              bar("2026-09-16T18:28:00Z", 64020),
            ],
          },
          next_page_token: "",
        },
      ],
    });
    const history = new PriceHistory(createTestLogger().logger, {
      credentials: { keyId: "key", secretKey: "secret" },
      fetch: fetchImpl,
    });
    const ticks = await collect(history);
    expect(
      ticks.map((tick) => [tick.timestamp, tick.symbol, tick.price, tick.size])
    ).toEqual([
      ["2026-09-16T18:26:00.000Z", "BTC/USD", 64000, 10],
      ["2026-09-16T18:26:00.000Z", "GLD", 243.1, 10],
      ["2026-09-16T18:26:00.000Z", "SPY", 512, 10],
      ["2026-09-16T18:27:00.000Z", "BTC/USD", 64010, 10],
      ["2026-09-16T18:27:00.000Z", "GLD", 243.5, 7],
    ]);
    expect(ticks[1]).toMatchObject({
      instrument: "gold",
      name: "Gold",
      source: "trade",
    });
    expect(urls).toHaveLength(3);
    expect(urls[0]).toBe(
      "https://data.alpaca.markets/v2/stocks/bars?symbols=GLD%2CSPY%2CUSO&timeframe=1Min&start=2026-09-16T18%3A25%3A00Z&end=2026-09-16T18%3A28%3A00Z&limit=10000&sort=asc&feed=sip&adjustment=raw"
    );
    expect(urls[1]).toContain("page_token=p2");
    expect(urls[2]).toBe(
      "https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=BTC%2FUSD&timeframe=1Min&start=2026-09-16T18%3A25%3A00Z&end=2026-09-16T18%3A28%3A00Z&limit=10000&sort=asc"
    );
    expect(headers[0]?.get("apca-api-key-id")).toBe("key");
    expect(headers[0]?.get("apca-api-secret-key")).toBe("secret");
  });

  it("honours feed, venue and bar length options", () => {
    const history = new PriceHistory(createTestLogger().logger, {
      credentials: { keyId: "k", secretKey: "s" },
      stockFeed: "iex",
      cryptoVenue: "us-1",
      barMinutes: 5,
      baseUrl: "http://localhost:1",
    });
    expect(history.url("stocks", range)).toContain("timeframe=5Min");
    expect(history.url("stocks", range)).toContain("feed=iex");
    expect(history.url("crypto", range, "tok")).toBe(
      "http://localhost:1/v1beta3/crypto/us-1/bars?symbols=BTC%2FUSD&timeframe=5Min&start=2026-09-16T18%3A25%3A00Z&end=2026-09-16T18%3A28%3A00Z&limit=10000&sort=asc&page_token=tok"
    );
  });

  it("tolerates an empty window, stops on a repeated page token and ends on abort", async () => {
    const empty = fakeFetch({
      stocks: [{ bars: null, next_page_token: null }],
      crypto: [{ bars: {}, next_page_token: null }],
    });
    const quiet = new PriceHistory(createTestLogger().logger, {
      credentials: { keyId: "k", secretKey: "s" },
      fetch: empty.fetchImpl,
    });
    expect(await collect(quiet)).toEqual([]);

    const looping = fakeFetch({
      stocks: [
        { bars: {}, next_page_token: "same" },
        { bars: {}, next_page_token: "same" },
      ],
    });
    const stuck = new PriceHistory(createTestLogger().logger, {
      credentials: { keyId: "k", secretKey: "s" },
      fetch: looping.fetchImpl,
    });
    await expect(collect(stuck)).rejects.toThrow(/repeated a page token/);

    const controller = new AbortController();
    const aborting: Fetch = () => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    };
    const cancelled = new PriceHistory(createTestLogger().logger, {
      credentials: { keyId: "k", secretKey: "s" },
      fetch: aborting,
    });
    const none = [];
    for await (const tick of cancelled.ticks(range, controller.signal))
      none.push(tick);
    expect(none).toEqual([]);
  });

  it("surfaces the API's message on a rejected request and rejects bad ranges or bars", async () => {
    const { fetchImpl } = fakeFetch({
      stocks: [
        {
          status: 403,
          message: "subscription does not permit querying recent SIP data",
        },
      ],
    });
    const history = new PriceHistory(createTestLogger().logger, {
      credentials: { keyId: "k", secretKey: "s" },
      fetch: fetchImpl,
    });
    await expect(collect(history)).rejects.toThrow(
      "403: subscription does not permit querying recent SIP data"
    );
    await expect(
      history.ticks({ from: range.to, to: range.from }).next()
    ).rejects.toThrow(/earlier time to a later one/);

    const bad = fakeFetch({
      stocks: [
        {
          bars: { GLD: [{ t: "2026-09-16T18:25:00Z", c: 0 }] },
          next_page_token: null,
        },
      ],
    });
    const broken = new PriceHistory(createTestLogger().logger, {
      credentials: { keyId: "k", secretKey: "s" },
      fetch: bad.fetchImpl,
    });
    await expect(collect(broken)).rejects.toThrow("invalid bar 0 for GLD");
  });
});
