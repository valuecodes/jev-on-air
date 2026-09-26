import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it, vi } from "vitest";

import { FakeServer, trade } from "./fake-socket";
import { AlpacaError } from "./protocol";
import { AlpacaStream } from "./stream";

const url = "wss://example.test/v2/iex";
const credentials = { keyId: "key", secretKey: "secret" };

function setup() {
  const server = new FakeServer();
  const { logger, lines } = createTestLogger();
  const stream = new AlpacaStream(logger, {
    url,
    credentials,
    symbols: ["SPY", "GLD"],
    createSocket: server.createSocket,
    retry: { minDelayMs: 1, maxDelayMs: 1 },
  });
  return { server, lines, stream };
}

describe("AlpacaStream", () => {
  it("authenticates, subscribes and yields trades", async () => {
    const { server, stream } = setup();
    const trades = stream.trades();
    const first = trades.next();

    const socket = server.latest(url);
    expect(socket.sent).toEqual([]);
    socket.receive({ T: "success", msg: "connected" });
    expect(socket.sent).toEqual([
      { action: "auth", key: "key", secret: "secret" },
    ]);
    socket.receive({ T: "success", msg: "authenticated" });
    expect(socket.sent[1]).toEqual({
      action: "subscribe",
      trades: ["SPY", "GLD"],
    });

    socket.receive(trade("SPY", 512.34), trade("GLD", 243.1));
    expect((await first).value).toMatchObject({ symbol: "SPY", price: 512.34 });
    expect((await trades.next()).value).toMatchObject({ symbol: "GLD" });

    await trades.return(undefined);
    expect(socket.closed).toBe(true);
  });

  it("reconnects after the connection drops", async () => {
    const { server, stream, lines } = setup();
    const trades = stream.trades();
    const first = trades.next();
    server.latest().accept();
    server.latest().drop();

    await vi.waitFor(() => {
      expect(server.sockets).toHaveLength(2);
    });
    const socket = server.latest();
    socket.accept();
    socket.receive(trade("SPY", 1));
    expect((await first).value).toMatchObject({ symbol: "SPY", price: 1 });
    expect(
      lines.some((line) => line.message === "stream closed, reconnecting")
    ).toBe(true);
    await trades.return(undefined);
  });

  it("reconnects after a transient server error", async () => {
    const { server, stream } = setup();
    const trades = stream.trades();
    const first = trades.next();
    server.latest().receive({ T: "error", code: 500, msg: "internal error" });
    expect(server.latest().closed).toBe(true);

    await vi.waitFor(() => {
      expect(server.sockets).toHaveLength(2);
    });
    server.latest().accept();
    server.latest().receive(trade("GLD", 2));
    expect((await first).value).toMatchObject({ symbol: "GLD" });
    await trades.return(undefined);
  });

  it("throws fatal errors without reconnecting", async () => {
    const { server, stream } = setup();
    const first = stream.trades().next();
    const socket = server.latest();
    socket.receive({ T: "success", msg: "connected" });
    socket.receive({ T: "error", code: 402, msg: "auth failed" });

    await expect(first).rejects.toThrow(AlpacaError);
    await expect(first).rejects.toThrow(/402: auth failed/);
    expect(socket.closed).toBe(true);
    expect(server.sockets).toHaveLength(1);
  });

  it("throws a connection-limit error on the first connection", async () => {
    const { server, stream } = setup();
    const first = stream.trades().next();
    server.latest().receive({ T: "success", msg: "connected" });
    server.latest().receive({ T: "error", code: 406, msg: "limit exceeded" });

    await expect(first).rejects.toThrow(/406/);
    expect(server.sockets).toHaveLength(1);
  });

  it("retries a connection-limit error after a drop", async () => {
    const { server, stream } = setup();
    const trades = stream.trades();
    const first = trades.next();
    server.latest().accept();
    server.latest().drop();

    // Alpaca still counts the dropped connection.
    await vi.waitFor(() => {
      expect(server.sockets).toHaveLength(2);
    });
    server.latest().receive({ T: "success", msg: "connected" });
    server.latest().receive({ T: "error", code: 406, msg: "limit exceeded" });

    await vi.waitFor(() => {
      expect(server.sockets).toHaveLength(3);
    });
    server.latest().accept();
    server.latest().receive(trade("SPY", 4));
    expect((await first).value).toMatchObject({ price: 4 });
    await trades.return(undefined);
  });

  it("reconnects when the handshake stalls", async () => {
    const server = new FakeServer();
    const { logger, lines } = createTestLogger();
    const stream = new AlpacaStream(logger, {
      url,
      credentials,
      symbols: ["SPY"],
      createSocket: server.createSocket,
      retry: { minDelayMs: 1, maxDelayMs: 1 },
      handshakeTimeoutMs: 20,
    });
    const trades = stream.trades();
    const first = trades.next();
    server.latest().receive({ T: "success", msg: "connected" });

    // Each retry times out too until the handshake completes, so wait for a
    // reconnect that is still open and finish its handshake at once.
    await vi.waitFor(() => {
      expect(server.sockets.length).toBeGreaterThanOrEqual(2);
      expect(server.latest().closed).toBe(false);
    });
    expect(server.sockets[0]?.closed).toBe(true);
    expect(lines.some((line) => line.message === "handshake timed out")).toBe(
      true
    );
    server.latest().accept();
    server.latest().receive({ T: "subscription", trades: ["SPY"] });
    server.latest().receive(trade("SPY", 5));
    expect((await first).value).toMatchObject({ price: 5 });
    await trades.return(undefined);
  });

  it("reconnects when a subscribed stream goes silent", async () => {
    const server = new FakeServer();
    const { logger, lines } = createTestLogger();
    const stream = new AlpacaStream(logger, {
      url,
      credentials,
      symbols: ["BTC/USD"],
      createSocket: server.createSocket,
      retry: { minDelayMs: 1 },
      idleTimeoutMs: 5,
    });
    const controller = new AbortController();
    const first = stream.trades(controller.signal).next();
    server.latest().accept();
    server.latest().receive({ T: "subscription", trades: ["BTC/USD"] });

    await vi.waitFor(() => {
      expect(server.sockets.length).toBeGreaterThanOrEqual(2);
    });
    expect(server.sockets[0]?.closed).toBe(true);
    expect(
      lines.some((line) => line.message === "no data, stream looks dead")
    ).toBe(true);
    controller.abort();
    await expect(first).resolves.toMatchObject({ done: true });
  });

  it("keeps backing off when the server closes right after auth", async () => {
    const { logger, lines } = createTestLogger();
    const server = new FakeServer();
    const stream = new AlpacaStream(logger, {
      url,
      credentials,
      symbols: ["SPY"],
      createSocket: server.createSocket,
      retry: { minDelayMs: 1, maxDelayMs: 1000 },
    });
    const controller = new AbortController();
    const first = stream.trades(controller.signal).next();
    for (let i = 1; i <= 3; i++) {
      await vi.waitFor(() => {
        expect(server.sockets).toHaveLength(i);
      });
      server.latest().accept();
      server.latest().drop();
    }
    await vi.waitFor(() => {
      expect(server.sockets).toHaveLength(4);
    });
    const delays = lines
      .filter((line) => line.message === "stream closed, reconnecting")
      .map((line) => line.delayMs);
    expect(delays).toEqual([1, 2, 4]);
    controller.abort();
    await expect(first).resolves.toMatchObject({ done: true });
  });

  it("stops when the signal aborts", async () => {
    const { server, stream } = setup();
    const controller = new AbortController();
    const first = stream.trades(controller.signal).next();
    server.latest().accept();

    controller.abort();
    expect(await first).toEqual({ done: true, value: undefined });
    expect(server.latest().closed).toBe(true);
    expect(server.sockets).toHaveLength(1);
  });

  it("stops while waiting to reconnect when the signal aborts", async () => {
    const { server } = setup();
    const { logger } = createTestLogger();
    const stream = new AlpacaStream(logger, {
      url,
      credentials,
      symbols: ["SPY"],
      createSocket: server.createSocket,
      retry: { minDelayMs: 60_000 },
    });
    const controller = new AbortController();
    const first = stream.trades(controller.signal).next();
    server.latest().drop();
    await Promise.resolve();

    controller.abort();
    expect(await first).toEqual({ done: true, value: undefined });
    expect(server.sockets).toHaveLength(1);
  });

  it("does not connect when the signal is already aborted", async () => {
    const { server, stream } = setup();
    const result = await stream.trades(AbortSignal.abort()).next();
    expect(result.done).toBe(true);
    expect(server.sockets).toHaveLength(0);
  });

  it("skips unreadable frames", async () => {
    const { server, stream, lines } = setup();
    const trades = stream.trades();
    const first = trades.next();
    const socket = server.latest();
    socket.accept();
    socket.receiveRaw("not json");
    socket.receive(trade("SPY", 3));
    expect((await first).value).toMatchObject({ price: 3 });
    expect(lines.some((line) => line.message === "unreadable frame")).toBe(
      true
    );
    await trades.return(undefined);
  });
});
