// Past prices for the instruments in `instruments.ts`, from Alpaca's
// historical bars API: one tick per bar, priced at the bar's close and
// stamped with the bar's end, so a replay never sees a price before the
// market did. Stocks and crypto come from separate endpoints and are merged
// into one time-ordered stream.
import type { LoggerLike } from "@repo/logger";

import { instrumentForSymbol, INSTRUMENTS } from "./instruments";
import type { Market } from "./instruments";
import type { CryptoVenue, PriceTick, StockFeed } from "./prices";
import type { Credentials } from "./protocol";

/** The subset of `fetch` the fetcher needs; the global one fits. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type PriceHistoryOptions = {
  credentials: Credentials;
  /** Stock feed for history; `sip` (the default) is the whole market. */
  stockFeed?: StockFeed;
  /** Crypto venue for history (default `us`, Alpaca's own). */
  cryptoVenue?: CryptoVenue;
  /** Bar length in minutes (default 1). */
  barMinutes?: number;
  /** Injectable for tests. */
  fetch?: Fetch;
  baseUrl?: string;
};

/** A half-open window of RFC 3339 times: bars opening at `to` are left out. */
export type Range = { from: string; to: string };

type Bar = { t: string; c: number; v: number };
type BarsPage = { bars: Record<string, Bar[]>; next_page_token: string | null };

const defaultBaseUrl = "https://data.alpaca.markets";
const pageLimit = 10_000;

export class HistoryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(`${status}: ${message}`);
    this.name = "HistoryError";
    this.status = status;
  }
}

function parsePage(value: unknown): BarsPage {
  if (typeof value !== "object" || value === null || !("bars" in value))
    throw new Error("bars response has no bars");
  const { bars, next_page_token: token } = value as {
    bars: unknown;
    next_page_token?: unknown;
  };
  // An empty window comes back as `null`.
  if (bars !== null && typeof bars !== "object")
    throw new Error("bars response has no bars");
  const result: Record<string, Bar[]> = {};
  for (const [symbol, list] of Object.entries(bars ?? {})) {
    if (!Array.isArray(list)) continue;
    result[symbol] = list.map((bar: unknown, index) => {
      const { t, c, v } = (bar ?? {}) as Partial<Bar>;
      if (
        typeof t !== "string" ||
        !Number.isFinite(Date.parse(t)) ||
        typeof c !== "number" ||
        !Number.isFinite(c) ||
        c <= 0
      )
        throw new Error(`invalid bar ${index} for ${symbol}`);
      return { t, c, v: typeof v === "number" ? v : 0 };
    });
  }
  return {
    bars: result,
    next_page_token: typeof token === "string" && token !== "" ? token : null,
  };
}

export class PriceHistory {
  private readonly logger: LoggerLike;
  private readonly options: PriceHistoryOptions;
  private readonly fetch: Fetch;
  private readonly baseUrl: string;

  constructor(logger: LoggerLike, options: PriceHistoryOptions) {
    this.logger = logger.child({ component: "history" });
    this.options = options;
    this.fetch = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
  }

  /** The bars endpoint for a market, with the query for `range`. */
  url(market: Market, range: Range, pageToken?: string): string {
    const symbols = INSTRUMENTS.filter((i) => i.market === market)
      .map((i) => i.symbol)
      .join(",");
    const query = new URLSearchParams({
      symbols,
      timeframe: `${this.options.barMinutes ?? 1}Min`,
      start: range.from,
      end: range.to,
      limit: String(pageLimit),
      sort: "asc",
    });
    if (market === "stocks") {
      query.set("feed", this.options.stockFeed ?? "sip");
      query.set("adjustment", "raw");
    }
    if (pageToken !== undefined) query.set("page_token", pageToken);
    const path =
      market === "stocks"
        ? "/v2/stocks/bars"
        : `/v1beta3/crypto/${this.options.cryptoVenue ?? "us"}/bars`;
    return `${this.baseUrl}${path}?${query.toString()}`;
  }

  /**
   * Yields one tick per bar in `range`, across all instruments in time
   * order. Every tick is buffered before the first is yielded, which is
   * fine for hours and unwise for years. Throws `HistoryError` on a rejected
   * request, which is how a free plan asking for the last 15 minutes of SIP
   * data fails; ends quietly when `signal` aborts.
   */
  async *ticks(range: Range, signal?: AbortSignal): AsyncGenerator<PriceTick> {
    if (!(Date.parse(range.from) < Date.parse(range.to)))
      throw new Error("range must run from an earlier time to a later one");
    const ticks: PriceTick[] = [];
    const barMs = (this.options.barMinutes ?? 1) * 60_000;
    const toMs = Date.parse(range.to);
    for (const market of ["stocks", "crypto"] as const) {
      let pageToken: string | undefined;
      let pages = 0;
      do {
        let page: BarsPage;
        try {
          page = await this.page(market, range, pageToken, signal);
        } catch (error) {
          if (signal?.aborted) return;
          throw error;
        }
        pages += 1;
        for (const [symbol, bars] of Object.entries(page.bars)) {
          const instrument = instrumentForSymbol(symbol);
          if (!instrument) continue;
          // Alpaca includes a bar opening exactly at `end`; the window is half-open.
          for (const bar of bars.filter((b) => Date.parse(b.t) < toMs))
            ticks.push({
              instrument: instrument.id,
              name: instrument.name,
              symbol,
              source: "trade",
              price: bar.c,
              // The bar's volume, not one trade's size.
              size: bar.v,
              timestamp: new Date(Date.parse(bar.t) + barMs).toISOString(),
            });
        }
        const next = page.next_page_token ?? undefined;
        if (next !== undefined && next === pageToken)
          throw new Error(`${market} bars: the server repeated a page token`);
        pageToken = next;
      } while (pageToken !== undefined);
      this.logger.info("fetched history", {
        market,
        pages,
        from: range.from,
        to: range.to,
      });
    }
    ticks.sort(
      (a, b) =>
        Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
        a.symbol.localeCompare(b.symbol)
    );
    for (const tick of ticks) {
      if (signal?.aborted) return;
      yield tick;
    }
  }

  private async page(
    market: Market,
    range: Range,
    pageToken: string | undefined,
    signal?: AbortSignal
  ): Promise<BarsPage> {
    const { keyId, secretKey } = this.options.credentials;
    const response = await this.fetch(this.url(market, range, pageToken), {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secretKey,
        Accept: "application/json",
      },
      signal,
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string"
          ? body.message
          : response.statusText;
      throw new HistoryError(response.status, message);
    }
    return parsePage(body);
  }
}
