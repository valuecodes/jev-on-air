// Alpaca market-data WebSocket protocol: the messages we send and the ones we
// read back. Every server frame is a JSON array of messages tagged by `T`.
// https://docs.alpaca.markets/docs/streaming-market-data

export type Credentials = { keyId: string; secretKey: string };

export type Trade = {
  symbol: string;
  price: number;
  size: number;
  /** RFC 3339 timestamp from the exchange, up to nanosecond precision. */
  timestamp: string;
};

export type Quote = {
  symbol: string;
  bidPrice: number;
  bidSize: number;
  askPrice: number;
  askSize: number;
  /** RFC 3339 timestamp from the exchange, up to nanosecond precision. */
  timestamp: string;
};

/** What a subscribed stream delivers. */
export type MarketData =
  { type: "trade"; trade: Trade } | { type: "quote"; quote: Quote };

export type AlpacaMessage =
  | { type: "connected" }
  | { type: "authenticated" }
  | { type: "subscription"; trades: string[]; quotes: string[] }
  | { type: "error"; code: number; message: string }
  | MarketData;

export function authMessage(credentials: Credentials): string {
  return JSON.stringify({
    action: "auth",
    key: credentials.keyId,
    secret: credentials.secretKey,
  });
}

/**
 * Subscribes to trades and quotes. Trades can be minutes apart (Alpaca's own
 * crypto venue is thin, IEX is a small share of stock volume); quotes keep
 * the price current in between.
 */
export function subscribeMessage(symbols: readonly string[]): string {
  return JSON.stringify({
    action: "subscribe",
    trades: symbols,
    quotes: symbols,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function parseMessage(value: unknown): AlpacaMessage | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.T) {
    case "success":
      if (value.msg === "connected") return { type: "connected" };
      if (value.msg === "authenticated") return { type: "authenticated" };
      return undefined;
    case "subscription":
      return {
        type: "subscription",
        trades: isStringArray(value.trades) ? value.trades : [],
        quotes: isStringArray(value.quotes) ? value.quotes : [],
      };
    case "error":
      if (typeof value.code !== "number") return undefined;
      return {
        type: "error",
        code: value.code,
        message: typeof value.msg === "string" ? value.msg : "",
      };
    case "t":
      if (
        typeof value.S !== "string" ||
        typeof value.p !== "number" ||
        typeof value.s !== "number" ||
        typeof value.t !== "string"
      )
        return undefined;
      return {
        type: "trade",
        trade: {
          symbol: value.S,
          price: value.p,
          size: value.s,
          timestamp: value.t,
        },
      };
    case "q":
      if (
        typeof value.S !== "string" ||
        typeof value.bp !== "number" ||
        typeof value.bs !== "number" ||
        typeof value.ap !== "number" ||
        typeof value.as !== "number" ||
        typeof value.t !== "string"
      )
        return undefined;
      return {
        type: "quote",
        quote: {
          symbol: value.S,
          bidPrice: value.bp,
          bidSize: value.bs,
          askPrice: value.ap,
          askSize: value.as,
          timestamp: value.t,
        },
      };
    default:
      return undefined;
  }
}

/**
 * Parses one server frame. Messages we do not use (bars, corrections,
 * unknown types) are dropped. Throws if the frame is not a JSON array.
 */
export function parseFrame(data: string): AlpacaMessage[] {
  const value: unknown = JSON.parse(data);
  if (!Array.isArray(value)) throw new Error(`not an Alpaca frame: ${data}`);
  return value.flatMap((item) => parseMessage(item) ?? []);
}

// Errors that reconnecting cannot fix: a malformed request (400), bad or
// missing credentials (401, 402), the plan's symbol or connection limit (405,
// 406 — another client already holds the one free connection), or a feed the
// subscription does not include (409, 410). The rest — auth timeout (404),
// slow client (407), internal error (500) — are worth retrying.
const fatalCodes = new Set([400, 401, 402, 405, 406, 409, 410]);

export function isFatalError(code: number): boolean {
  return fatalCodes.has(code);
}

export class AlpacaError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`alpaca error ${code}: ${message}`);
    this.name = "AlpacaError";
    this.code = code;
  }
}
