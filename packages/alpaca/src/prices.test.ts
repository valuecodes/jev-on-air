import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it, vi } from "vitest";

import { FakeServer, quote, trade } from "./fake-socket";
import { PriceFeed, streamUrl } from "./prices";

const stocksUrl = "wss://stream.data.alpaca.markets/v2/iex";
const cryptoUrl = "wss://stream.data.alpaca.markets/v1beta3/crypto/us-1";

const setup = () => {
  const server = new FakeServer();
  const { logger } = createTestLogger();
  const feed = new PriceFeed(logger, {
    credentials: { keyId: "key", secretKey: "secret" },
    createSocket: server.createSocket,
    retry: { minDelayMs: 1, maxDelayMs: 1 },
  });
  return { server, feed };
};

describe("streamUrl", () => {
  it("picks the stock feed and the crypto endpoint", () => {
    const feeds = { stockFeed: "iex", cryptoVenue: "us-1" } as const;
    expect(streamUrl("stocks", feeds)).toBe(stocksUrl);
    expect(streamUrl("stocks", { ...feeds, stockFeed: "sip" })).toBe(
      "wss://stream.data.alpaca.markets/v2/sip"
    );
    expect(streamUrl("crypto", feeds)).toBe(cryptoUrl);
    expect(streamUrl("crypto", { ...feeds, cryptoVenue: "us" })).toBe(
      "wss://stream.data.alpaca.markets/v1beta3/crypto/us"
    );
  });
});

describe("PriceFeed", () => {
  it("subscribes each market to its symbols", async () => {
    const { server, feed } = setup();
    const ticks = feed.stream();
    const first = ticks.next();
    await Promise.resolve();

    server.latest(stocksUrl).accept();
    server.latest(cryptoUrl).accept();
    expect(server.latest(stocksUrl).sent[1]).toEqual({
      action: "subscribe",
      trades: ["GLD", "SPY", "USO"],
      quotes: ["GLD", "SPY", "USO"],
    });
    expect(server.latest(cryptoUrl).sent[1]).toEqual({
      action: "subscribe",
      trades: ["BTC/USD"],
      quotes: ["BTC/USD"],
    });

    server.latest(cryptoUrl).receive(trade("BTC/USD", 64_000.5));
    expect((await first).value).toEqual({
      instrument: "bitcoin",
      name: "Bitcoin",
      symbol: "BTC/USD",
      source: "trade",
      price: 64_000.5,
      size: 10,
      timestamp: "2026-09-25T14:31:07.123Z",
    });
    await ticks.return(undefined);
  });

  it("merges ticks from both streams and drops unknown symbols", async () => {
    const { server, feed } = setup();
    const ticks = feed.stream();
    const first = ticks.next();
    await Promise.resolve();
    server.latest(stocksUrl).accept();
    server.latest(cryptoUrl).accept();

    server.latest(stocksUrl).receive(trade("AAPL", 1), trade("GLD", 243.1));
    server.latest(cryptoUrl).receive(trade("BTC/USD", 64_000));
    server.latest(stocksUrl).receive(trade("USO", 71.2), trade("SPY", 512));

    const results = [await first];
    for (let i = 0; i < 3; i++) {
      results.push(await ticks.next());
    }
    // Order holds within a stream; across streams it depends on scheduling.
    const instruments = results.map((result) =>
      result.done === true ? undefined : result.value.instrument
    );
    expect(instruments.filter((id) => id !== "bitcoin")).toEqual([
      "gold",
      "oil",
      "sp500",
    ]);
    expect(instruments).toContain("bitcoin");
    await ticks.return(undefined);
  });

  it("prices quotes at the midpoint when it moves", async () => {
    const { server, feed } = setup();
    const ticks = feed.stream();
    const first = ticks.next();
    await Promise.resolve();
    const crypto = server.latest(cryptoUrl);
    crypto.accept();

    crypto.receive(
      quote("BTC/USD", 63_999, 64_001),
      // Same midpoint, new prices: not a new tick.
      quote("BTC/USD", 63_998, 64_002),
      // Empty side and crossed book: not a price.
      quote("BTC/USD", 0, 64_001),
      quote("BTC/USD", 64_005, 64_001),
      quote("BTC/USD", 64_001, 64_003),
      trade("BTC/USD", 64_002.5)
    );

    const results = [await first];
    for (let i = 0; i < 2; i++) {
      results.push(await ticks.next());
    }
    expect(
      results.map((result) => (result.done === true ? undefined : result.value))
    ).toEqual([
      {
        instrument: "bitcoin",
        name: "Bitcoin",
        symbol: "BTC/USD",
        source: "quote",
        price: 64_000,
        bid: 63_999,
        ask: 64_001,
        timestamp: "2026-09-25T14:31:07.456Z",
      },
      expect.objectContaining({ source: "quote", price: 64_002 }),
      // A trade carries the latest quote alongside its own price.
      expect.objectContaining({
        source: "trade",
        price: 64_002.5,
        bid: 64_001,
        ask: 64_003,
        size: 10,
      }),
    ]);
    await ticks.return(undefined);
  });

  it("closes both streams when the consumer stops", async () => {
    const { server, feed } = setup();
    const ticks = feed.stream();
    const first = ticks.next();
    await Promise.resolve();
    server.latest(cryptoUrl).accept();
    server.latest(cryptoUrl).receive(trade("BTC/USD", 1));
    await first;

    await ticks.return(undefined);
    expect(server.sockets.every((socket) => socket.closed)).toBe(true);
  });

  it("closes the other stream and throws when one fails for good", async () => {
    const { server, feed } = setup();
    const first = feed.stream().next();
    await Promise.resolve();
    server.latest(cryptoUrl).accept();
    server
      .latest(stocksUrl)
      .receive({ T: "error", code: 406, msg: "connection limit exceeded" });

    await expect(first).rejects.toThrow(/406: connection limit exceeded/);
    expect(server.sockets.every((socket) => socket.closed)).toBe(true);
  });

  it("closes the other stream at once even with ticks still buffered", async () => {
    const { server, feed } = setup();
    const ticks = feed.stream();
    const first = ticks.next();
    await Promise.resolve();
    server.latest(cryptoUrl).accept();
    server.latest(stocksUrl).receive({ T: "success", msg: "connected" });
    server
      .latest(cryptoUrl)
      .receive(trade("BTC/USD", 1), trade("BTC/USD", 2), trade("BTC/USD", 3));
    await first;
    server
      .latest(stocksUrl)
      .receive({ T: "error", code: 402, msg: "auth failed" });

    // Two ticks are still buffered, but the crypto socket is already closed.
    await vi.waitFor(() => {
      expect(server.latest(cryptoUrl).closed).toBe(true);
    });
    await expect(async () => {
      for (;;) {
        if ((await ticks.next()).done === true) {
          break;
        }
      }
    }).rejects.toThrow(/402/);
    expect(server.sockets).toHaveLength(2);
  });

  it("ends when the signal aborts", async () => {
    const { server, feed } = setup();
    const controller = new AbortController();
    const first = feed.stream(controller.signal).next();
    await Promise.resolve();

    controller.abort();
    expect((await first).done).toBe(true);
    expect(server.sockets.every((socket) => socket.closed)).toBe(true);
  });
});
