// One Alpaca market-data WebSocket: authenticates, subscribes to trades and
// quotes and yields them, reconnecting with backoff when the connection drops.
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
import type { Credentials, MarketData } from "./protocol";

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
  /**
   * Reconnect if the subscription is not confirmed this soon after opening
   * the socket (default 15000).
   */
  handshakeTimeoutMs?: number;
  /**
   * Reconnect after this long without a frame. A half-open connection fires
   * no `close`, so this is how a silently dead stream is noticed. Off by
   * default: only set it for a stream that is never legitimately quiet.
   */
  idleTimeoutMs?: number;
};

// A connection that stays up this long counts as healthy even with no data.
const healthyAfterMs = 30_000;

type Connection = {
  data: Channel<MarketData>;
  /** Whether the server accepted our credentials on this connection. */
  authenticated: () => boolean;
  /** Whether the connection delivered data or stayed up a while. */
  healthy: () => boolean;
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
   * Yields trades and quotes until `signal` aborts or the consumer stops. A dropped
   * connection is reopened; an error reconnecting cannot fix (bad keys, the
   * plan's connection limit) is thrown.
   */
  async *marketData(signal?: AbortSignal): AsyncGenerator<MarketData> {
    const minDelay = this.options.retry?.minDelayMs ?? 1000;
    const maxDelay = this.options.retry?.maxDelayMs ?? 30_000;
    let attempt = 0;
    let everAuthenticated = false;
    while (!signal?.aborted) {
      const connection = this.connect(signal, everAuthenticated);
      try {
        yield* connection.data;
      } finally {
        connection.close();
      }
      if (signal?.aborted) return;

      if (connection.authenticated()) everAuthenticated = true;
      // Only a connection that actually worked starts the backoff over; one
      // the server keeps closing right after auth must not retry every second.
      if (connection.healthy()) attempt = 0;
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

  /**
   * `reconnecting` means an earlier connection of this stream authenticated.
   * After an unclean drop Alpaca can still count that connection for a while,
   * so a connection-limit error then is retried instead of thrown.
   */
  private connect(
    signal: AbortSignal | undefined,
    reconnecting: boolean
  ): Connection {
    const { url, credentials, symbols } = this.options;
    const createSocket = this.options.createSocket ?? createWebSocket;
    const { handshakeTimeoutMs = 15_000, idleTimeoutMs } = this.options;
    const data = new Channel<MarketData>();
    // Handlers can run before `createSocket` returns, so they reach the socket
    // through this holder rather than a `const` still in its dead zone.
    const holder: { socket?: Socket } = {};
    let authenticatedAt: number | undefined;
    let dataSeen = false;
    let closed = false;

    const expire = (reason: string): void => {
      this.logger.warn(reason);
      close();
    };
    let handshakeTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      expire("handshake timed out");
    }, handshakeTimeoutMs);
    let idleTimer: NodeJS.Timeout | undefined;

    // (Re)starts the idle watchdog; runs from the subscription onwards.
    const armIdle = (): void => {
      if (idleTimeoutMs === undefined || closed) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        expire("no data, stream looks dead");
      }, idleTimeoutMs);
    };

    const handleFrame = (frame: string): void => {
      if (handshakeTimer === undefined) armIdle();
      let messages;
      try {
        messages = parseFrame(frame);
      } catch (error) {
        this.logger.warn("unreadable frame", { err: error });
        return;
      }
      for (const message of messages) {
        switch (message.type) {
          case "connected":
            holder.socket?.send(authMessage(credentials));
            break;
          case "authenticated":
            authenticatedAt = Date.now();
            holder.socket?.send(subscribeMessage(symbols));
            break;
          case "subscription":
            this.logger.info("subscribed", {
              trades: message.trades,
              quotes: message.quotes,
            });
            clearTimeout(handshakeTimer);
            handshakeTimer = undefined;
            armIdle();
            break;
          case "error": {
            const error = new AlpacaError(message.code, message.message);
            const staleConnection = reconnecting && message.code === 406;
            if (isFatalError(message.code) && !staleConnection) {
              data.fail(error);
            } else {
              this.logger.warn("stream error", { err: error });
            }
            close();
            return;
          }
          case "trade":
          case "quote":
            dataSeen = true;
            data.push(message);
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
      clearTimeout(handshakeTimer);
      clearTimeout(idleTimer);
      signal?.removeEventListener("abort", onAbort);
      holder.socket?.close();
      data.end();
    };

    this.logger.debug("connecting");
    const socket = createSocket(url, {
      message: handleFrame,
      close: (code, reason) => {
        this.logger.debug("socket closed", { code, reason });
        close();
      },
    });
    // A socket that reported a failure synchronously is already done.
    holder.socket = socket;
    if (closed) socket.close();
    signal?.addEventListener("abort", onAbort, { once: true });

    return {
      data,
      authenticated: () => authenticatedAt !== undefined,
      healthy: () =>
        dataSeen ||
        (authenticatedAt !== undefined &&
          Date.now() - authenticatedAt >= healthyAfterMs),
      close,
    };
  }
}
