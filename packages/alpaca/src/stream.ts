// One Alpaca market-data WebSocket: authenticates, subscribes to trades and
// yields them, reconnecting with backoff when the connection drops.
import { setTimeout as sleep } from "node:timers/promises";
import type { LoggerLike } from "@repo/logger";

import { Channel } from "./channel";
import {
  AlpacaError,
  authMessage,
  isFatalError,
  parseFrame,
  subscribeMessage,
} from "./protocol";
import type { Credentials, Trade } from "./protocol";

export type SocketHandlers = {
  message(data: string): void;
  close(code: number, reason: string): void;
};

export type Socket = {
  send(data: string): void;
  close(): void;
};

/** Opens a WebSocket to `url` that reports to `handlers`. Injectable for tests. */
export type CreateSocket = (url: string, handlers: SocketHandlers) => Socket;

export const createWebSocket: CreateSocket = (url, handlers) => {
  const socket = new WebSocket(url);
  socket.addEventListener("message", (event) => {
    // Alpaca sends JSON as text frames unless msgpack is requested.
    if (typeof event.data === "string") handlers.message(event.data);
  });
  // A failed connection fires `error` then `close`, so `close` covers both.
  socket.addEventListener("close", (event) => {
    handlers.close(event.code, event.reason);
  });
  return {
    send: (data) => {
      socket.send(data);
    },
    close: () => {
      socket.close();
    },
  };
};

export type RetryOptions = {
  /** First reconnect delay; doubles per failed attempt (default 1000). */
  minDelayMs?: number;
  /** Reconnect delay cap (default 30000). */
  maxDelayMs?: number;
};

export type AlpacaStreamOptions = {
  url: string;
  credentials: Credentials;
  symbols: readonly string[];
  createSocket?: CreateSocket;
  retry?: RetryOptions;
};

type Connection = {
  trades: Channel<Trade>;
  /** Whether the server accepted our credentials on this connection. */
  authenticated: () => boolean;
  close: () => void;
};

export class AlpacaStream {
  private readonly logger: LoggerLike;
  private readonly options: AlpacaStreamOptions;

  constructor(logger: LoggerLike, options: AlpacaStreamOptions) {
    this.logger = logger.child({ stream: options.url });
    this.options = options;
  }

  /**
   * Yields trades until `signal` aborts or the consumer stops. A dropped
   * connection is reopened; an error reconnecting cannot fix (bad keys, the
   * plan's connection limit) is thrown.
   */
  async *trades(signal?: AbortSignal): AsyncGenerator<Trade> {
    const minDelay = this.options.retry?.minDelayMs ?? 1000;
    const maxDelay = this.options.retry?.maxDelayMs ?? 30_000;
    let attempt = 0;
    while (!signal?.aborted) {
      const connection = this.connect(signal);
      try {
        yield* connection.trades;
      } finally {
        connection.close();
      }
      if (signal?.aborted) return;

      // A connection that got as far as authenticating was healthy, so the
      // next drop starts the backoff over.
      if (connection.authenticated()) attempt = 0;
      const delay = Math.min(minDelay * 2 ** attempt, maxDelay);
      attempt += 1;
      this.logger.warn("stream closed, reconnecting", { delayMs: delay });
      try {
        await sleep(delay, undefined, { signal });
      } catch {
        return;
      }
    }
  }

  private connect(signal?: AbortSignal): Connection {
    const { url, credentials, symbols } = this.options;
    const createSocket = this.options.createSocket ?? createWebSocket;
    const trades = new Channel<Trade>();
    let authenticated = false;
    let closed = false;

    const handleFrame = (data: string): void => {
      let messages;
      try {
        messages = parseFrame(data);
      } catch (error) {
        this.logger.warn("unreadable frame", { err: error });
        return;
      }
      for (const message of messages) {
        switch (message.type) {
          case "connected":
            socket.send(authMessage(credentials));
            break;
          case "authenticated":
            authenticated = true;
            socket.send(subscribeMessage(symbols));
            break;
          case "subscription":
            this.logger.info("subscribed", { trades: message.trades });
            break;
          case "error": {
            const error = new AlpacaError(message.code, message.message);
            if (isFatalError(message.code)) {
              trades.fail(error);
            } else {
              this.logger.warn("stream error", { err: error });
            }
            close();
            return;
          }
          case "trade":
            trades.push(message.trade);
            break;
        }
      }
    };

    const onAbort = (): void => {
      close();
    };

    const close = (): void => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", onAbort);
      socket.close();
      trades.end();
    };

    this.logger.debug("connecting");
    const socket = createSocket(url, {
      message: handleFrame,
      close: (code, reason) => {
        this.logger.debug("socket closed", { code, reason });
        close();
      },
    });
    signal?.addEventListener("abort", onAbort, { once: true });

    return { trades, authenticated: () => authenticated, close };
  }
}
