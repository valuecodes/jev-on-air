import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it } from "vitest";

import { FakeServer, trade } from "./fake-socket";
import { PriceFeed, streamUrl } from "./prices";

const stocksUrl = "wss://stream.data.alpaca.markets/v2/iex";
const cryptoUrl = "wss://stream.data.alpaca.markets/v1beta3/crypto/us";

function setup() {
  const server = new FakeServer();
  const { logger } = createTestLogger();
  const feed = new PriceFeed(logger, {
    credentials: { keyId: "key", secretKey: "secret" },
    createSocket: server.createSocket,
    retry: { minDelayMs: 1, maxDelayMs: 1 },
  });
  return { server, feed };
}

describe("streamUrl", () => {
  it("picks the stock feed and the crypto endpoint", () => {
    expect(streamUrl("stocks", "iex")).toBe(stocksUrl);
    expect(streamUrl("stocks", "sip")).toBe(
      "wss://stream.data.alpaca.markets/v2/sip"
    );
    expect(streamUrl("crypto", "sip")).toBe(cryptoUrl);
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
    });
    expect(server.latest(cryptoUrl).sent[1]).toEqual({
      action: "subscribe",
      trades: ["BTC/USD"],
    });

    server.latest(cryptoUrl).receive(trade("BTC/USD", 64000.5));
    expect((await first).value).toEqual({
      instrument: "bitcoin",
      name: "Bitcoin",
      symbol: "BTC/USD",
      price: 64000.5,
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
    server.latest(cryptoUrl).receive(trade("BTC/USD", 64000));
    server.latest(stocksUrl).receive(trade("USO", 71.2), trade("SPY", 512));

    const results = [await first];
    for (let i = 0; i < 3; i++) results.push(await ticks.next());
    // Order holds within a stream; across streams it depends on scheduling.
    const instruments = results.map((result) =>
      result.done ? undefined : result.value.instrument
    );
    expect(instruments.filter((id) => id !== "bitcoin")).toEqual([
      "gold",
      "oil",
      "sp500",
    ]);
    expect(instruments).toContain("bitcoin");
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
