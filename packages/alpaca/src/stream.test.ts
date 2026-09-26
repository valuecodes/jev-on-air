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
    // @ts-expect-error -- reach the raw handler to send a broken frame
    socket.handlers.message("not json");
    socket.receive(trade("SPY", 3));
    expect((await first).value).toMatchObject({ price: 3 });
    expect(lines.some((line) => line.message === "unreadable frame")).toBe(
      true
    );
    await trades.return(undefined);
  });
});
