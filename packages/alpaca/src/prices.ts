// Live prices for the instruments in `instruments.ts`, streamed from Alpaca.
// Stocks and crypto arrive on separate WebSockets; this merges them into one
// stream of price ticks.
import type { LoggerLike } from "@repo/logger";

import { Channel } from "./channel";
import { instrumentForSymbol, INSTRUMENTS } from "./instruments";
import type { InstrumentId, Market } from "./instruments";
import type { Credentials, Trade } from "./protocol";
import { AlpacaStream } from "./stream";
import type { CreateSocket, RetryOptions } from "./stream";

export type PriceTick = {
  instrument: InstrumentId;
  name: string;
  symbol: string;
  price: number;
  size: number;
  /** RFC 3339 trade time from the exchange. */
  timestamp: string;
};

export type PriceFeedOptions = {
  credentials: Credentials;
  /**
   * Stock data feed: `iex` is real time on the free plan but covers one
   * exchange; `sip` covers every US exchange and needs a paid plan.
   */
  stockFeed?: "iex" | "sip";
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

export function streamUrl(market: Market, stockFeed: "iex" | "sip"): string {
  return market === "stocks"
    ? `${dataHost}/v2/${stockFeed}`
    : `${dataHost}/v1beta3/crypto/us`;
}

function toTick(trade: Trade): PriceTick | undefined {
  const instrument = instrumentForSymbol(trade.symbol);
  if (!instrument) return undefined;
  return {
    instrument: instrument.id,
    name: instrument.name,
    symbol: trade.symbol,
    price: trade.price,
    size: trade.size,
    timestamp: trade.timestamp,
  };
}

export class PriceFeed {
  private readonly streams: AlpacaStream[];

  constructor(logger: LoggerLike, options: PriceFeedOptions) {
    const stockFeed = options.stockFeed ?? "iex";
    const markets: Market[] = ["stocks", "crypto"];
    this.streams = markets.map(
      (market) =>
        new AlpacaStream(logger, {
          url: streamUrl(market, stockFeed),
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
   * Yields a tick per trade on any instrument until `signal` aborts or the
   * consumer stops. If either stream fails for good, the other is closed and
   * the error is thrown.
   */
  async *stream(signal?: AbortSignal): AsyncGenerator<PriceTick> {
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const ticks = new Channel<PriceTick>();
    const pumps = this.streams.map(async (stream) => {
      for await (const trade of stream.trades(controller.signal)) {
        const tick = toTick(trade);
        if (tick) ticks.push(tick);
      }
    });
    void Promise.all(pumps).then(
      () => {
        ticks.end();
      },
      (error: unknown) => {
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
