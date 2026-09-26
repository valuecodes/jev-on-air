// Live prices for the instruments in `instruments.ts`, streamed from Alpaca.
// Stocks and crypto arrive on separate WebSockets; this merges them into one
// stream of price ticks.
import type { LoggerLike } from "@repo/logger";

import { Channel } from "./channel";
import { instrumentForSymbol, INSTRUMENTS } from "./instruments";
import type { InstrumentId, Market } from "./instruments";
import type { Credentials, MarketData } from "./protocol";
import { AlpacaStream } from "./stream";
import type { CreateSocket, RetryOptions } from "./stream";

export type PriceTick = {
  instrument: InstrumentId;
  name: string;
  symbol: string;
  /**
   * `trade`: a trade printed at `price`. `quote`: the bid/ask moved and
   * `price` is its new midpoint.
   */
  source: "trade" | "quote";
  price: number;
  /** Latest bid and ask for the symbol, once a quote has arrived. */
  bid?: number;
  ask?: number;
  /** Shares or coins traded; trades only. */
  size?: number;
  /** RFC 3339 exchange time of the trade or quote. */
  timestamp: string;
};

export type PriceFeedOptions = {
  credentials: Credentials;
  /**
   * Stock data feed: `iex` is real time on the free plan but covers one
   * exchange; `sip` covers every US exchange and needs a paid plan.
   */
  stockFeed?: StockFeed;
  /**
   * Crypto venue: `us-1` (Kraken US, the default) and `eu-1` (Kraken EU) are
   * liquid; `us` is Alpaca's own venue, where Alpaca fills crypto orders but
   * quotes arrive in sparse bursts with a wide spread.
   */
  cryptoVenue?: CryptoVenue;
  createSocket?: CreateSocket;
  retry?: RetryOptions;
};

const dataHost = "wss://stream.data.alpaca.markets";

// Bitcoin trades around the clock, so two silent minutes mean a dead
// connection. Stocks are legitimately silent outside market hours.
const idleTimeoutMs: Record<Market, number | undefined> = {
  stocks: undefined,
  crypto: 120_000,
};

export type StockFeed = "iex" | "sip";
export type CryptoVenue = "us" | "us-1" | "eu-1";

export function streamUrl(
  market: Market,
  feeds: { stockFeed: StockFeed; cryptoVenue: CryptoVenue }
): string {
  return market === "stocks"
    ? `${dataHost}/v2/${feeds.stockFeed}`
    : `${dataHost}/v1beta3/crypto/${feeds.cryptoVenue}`;
}

type Book = { bid: number; ask: number; mid: number };

/**
 * Turns market data into ticks, remembering each symbol's latest quote. A
 * quote only becomes a tick when it moves the midpoint: quotes arrive many
 * times a second, mostly resizing the same prices.
 */
class TickBuilder {
  private readonly books = new Map<string, Book>();

  build(data: MarketData): PriceTick | undefined {
    const symbol =
      data.type === "trade" ? data.trade.symbol : data.quote.symbol;
    const instrument = instrumentForSymbol(symbol);
    if (!instrument) return undefined;
    const base = { instrument: instrument.id, name: instrument.name, symbol };

    if (data.type === "trade") {
      const book = this.books.get(symbol);
      return {
        ...base,
        source: "trade",
        price: data.trade.price,
        bid: book?.bid,
        ask: book?.ask,
        size: data.trade.size,
        timestamp: data.trade.timestamp,
      };
    }

    const { bidPrice: bid, askPrice: ask, timestamp } = data.quote;
    // A side with no orders is sent as 0 (common outside market hours), and
    // a crossed book is not a price anyone can trade at.
    if (bid <= 0 || ask <= 0 || ask < bid) return undefined;
    const mid = (bid + ask) / 2;
    const previous = this.books.get(symbol);
    this.books.set(symbol, { bid, ask, mid });
    if (previous?.mid === mid) return undefined;
    return { ...base, source: "quote", price: mid, bid, ask, timestamp };
  }
}

export class PriceFeed {
  private readonly streams: AlpacaStream[];

  constructor(logger: LoggerLike, options: PriceFeedOptions) {
    const feeds = {
      stockFeed: options.stockFeed ?? "iex",
      cryptoVenue: options.cryptoVenue ?? "us-1",
    };
    const markets: Market[] = ["stocks", "crypto"];
    this.streams = markets.map(
      (market) =>
        new AlpacaStream(logger, {
          url: streamUrl(market, feeds),
          credentials: options.credentials,
          symbols: INSTRUMENTS.filter(
            (instrument) => instrument.market === market
          ).map((instrument) => instrument.symbol),
          createSocket: options.createSocket,
          retry: options.retry,
          idleTimeoutMs: idleTimeoutMs[market],
        })
    );
  }

  /**
   * Yields a tick per trade, and per quote that moves the midpoint, on any
   * instrument until `signal` aborts or the consumer stops. If either stream
   * fails for good, the other is closed and the error is thrown.
   */
  async *stream(signal?: AbortSignal): AsyncGenerator<PriceTick> {
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const ticks = new Channel<PriceTick>();
    const builder = new TickBuilder();
    const pumps = this.streams.map(async (stream) => {
      for await (const data of stream.marketData(controller.signal)) {
        const tick = builder.build(data);
        if (tick) ticks.push(tick);
      }
    });
    void Promise.all(pumps).then(
      () => {
        ticks.end();
      },
      (error: unknown) => {
        // Stop the surviving stream now, not once the consumer has drained
        // whatever is still buffered.
        controller.abort();
        ticks.fail(error);
      }
    );

    try {
      yield* ticks;
    } finally {
      controller.abort();
      signal?.removeEventListener("abort", onAbort);
      await Promise.allSettled(pumps);
    }
  }
}
