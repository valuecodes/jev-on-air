# @repo/alpaca

Market data from [Alpaca](https://docs.alpaca.markets/us/docs/getting-started). For now it
streams live prices for the instruments Jev watches. Paper trading will be added to this
package later.

```ts
import { PriceFeed } from "@repo/alpaca/prices";

const feed = new PriceFeed(logger, {
  credentials: { keyId: "…", secretKey: "…" },
});
for await (const tick of feed.stream(signal)) {
  // { instrument: "bitcoin", name: "Bitcoin", symbol: "BTC/USD", source: "quote",
  //   price: 64000.25, bid: 64000, ask: 64000.5, timestamp: "2026-09-25T14:31:07.123Z" }
}
```

There is no index module. Import from `@repo/alpaca/prices`, `@repo/alpaca/history` and
`@repo/alpaca/instruments`.
`@repo/alpaca/channel` exports the push-to-pull queue the feed is built on; `@repo/jev` uses it
to merge streams.

## Instruments

Alpaca offers US stocks and ETFs, options and crypto. It has no spot metals, no commodities
and no index futures. Gold, oil and the S&P 500 are therefore priced through the most liquid
ETF for each. All of these proxies can be traded on Alpaca, so a signal can later be
paper-traded on the same symbol it was priced from.

| Instrument | Symbol    | Stream                                                 | Hours                     |
| ---------- | --------- | ------------------------------------------------------ | ------------------------- |
| Gold       | `GLD`     | `wss://stream.data.alpaca.markets/v2/iex`              | US market hours, weekdays |
| Oil        | `USO`     | same                                                   | same                      |
| S&P 500    | `SPY`     | same                                                   | same                      |
| Bitcoin    | `BTC/USD` | `wss://stream.data.alpaca.markets/v1beta3/crypto/us-1` | 24/7                      |

To add an instrument, add a row to `INSTRUMENTS` in `src/instruments.ts`.

## How it works

- Stocks and crypto each arrive on their own WebSocket, using Node's built-in `WebSocket`.
  `PriceFeed` merges the two into a single stream of ticks. Ticks from the same stream keep
  their order. Ticks from different streams can interleave in any order.
- Each connection goes through the same steps: it waits for `connected`, sends `auth`,
  waits for `authenticated`, then subscribes to `trades` and `quotes`.
- Each trade becomes a tick (`source: "trade"`, `price` is the trade price). A quote
  becomes a tick only when it moves the bid/ask midpoint (`source: "quote"`, `price` is
  the midpoint). Quotes with an empty side or a crossed book are skipped. Every tick
  carries the latest `bid` and `ask` once a quote has arrived.
- Quotes are subscribed because trades alone can be sparse. IEX is only a small share of
  US stock volume.
- Crypto comes from Kraken US (`cryptoVenue: "us-1"`) by default. Alpaca's own venue
  (`"us"`) is where Alpaca fills crypto orders. Its BTC/USD quotes arrive in bursts, often
  tens of seconds apart, with a spread around $25. On Kraken the spread is around $1.50,
  with several updates a second. Expect prices to differ slightly between the two venues.
  `"eu-1"` is Kraken EU.
- Dropped connections and transient server errors are retried with exponential backoff,
  from 1 s up to a 30 s cap. The backoff resets once a connection has delivered data
  or stayed up for 30 s.
- A connection is also reopened if the handshake isn't done within 15 s. The crypto stream
  is reopened after 2 minutes with no data at all, because a half-open socket never fires
  `close` and Bitcoin trades around the clock. Stocks have no idle limit, since they go
  quiet outside market hours.
- Some errors can't be fixed by reconnecting, so they close both streams and are thrown:
  bad keys (401/402), the plan's symbol or connection limit (405/406), and a feed your plan
  doesn't include (409/410). The one exception is a 406 on a reconnect. After an unclean
  drop, Alpaca can briefly keep counting the dead connection, so that case is retried.

## Historical prices

`PriceHistory` (`@repo/alpaca/history`) fetches a past window from the historical bars API and
yields the same `PriceTick` shape as the live feed: one tick per bar for every instrument,
priced at the bar's close and stamped with the bar's end, all in time order. Stocks come from
`/v2/stocks/bars` (SIP by default) and crypto from `/v1beta3/crypto/{venue}/bars`, paged until
`next_page_token` is empty. A rejected request throws `HistoryError` with the API's message.

```ts
import { PriceHistory } from "@repo/alpaca/history";

const history = new PriceHistory(logger, { credentials, barMinutes: 1 });
for await (const tick of history.ticks({
  from: "2026-09-16T18:20:00Z",
  to: "2026-09-16T19:10:00Z",
})) {
  // { instrument: "gold", symbol: "GLD", source: "trade", price: 243.1, size: 1200, timestamp: "2026-09-16T18:21:00.000Z" }
}
```

## Plan limits

The free Basic plan gives real-time stock data from the IEX exchange only. IEX is a small
share of US volume, so stock ticks are sparser than on the full tape. The plan allows 30
symbols and **one connection per endpoint**. If another client using the same keys is
already connected, the stream fails with error 406. Passing `stockFeed: "sip"` switches to
the all-exchange feed, which needs a paid plan. Keys from a paper-trading account work for
market data. Historical bars cover the whole market since 2016, except the most recent 15
minutes, which the free plan only serves from IEX.

## Common commands

```bash
pnpm --filter @repo/alpaca test
pnpm --filter @repo/alpaca typecheck
```
