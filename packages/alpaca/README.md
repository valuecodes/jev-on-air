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
  // { instrument: "gold", name: "Gold", symbol: "GLD", price: 243.12, size: 100,
  //   timestamp: "2026-09-25T14:31:07.123456789Z" }
}
```

There is no index module. Import from `@repo/alpaca/prices` and `@repo/alpaca/instruments`.

## Instruments

Alpaca offers US stocks and ETFs, options and crypto. It has no spot metals, no commodities
and no index futures. Gold, oil and the S&P 500 are therefore priced through the most liquid
ETF for each. All of these proxies can be traded on Alpaca, so a signal can later be
paper-traded on the same symbol it was priced from.

| Instrument | Symbol    | Stream                                               | Hours                     |
| ---------- | --------- | ---------------------------------------------------- | ------------------------- |
| Gold       | `GLD`     | `wss://stream.data.alpaca.markets/v2/iex`            | US market hours, weekdays |
| Oil        | `USO`     | same                                                 | same                      |
| S&P 500    | `SPY`     | same                                                 | same                      |
| Bitcoin    | `BTC/USD` | `wss://stream.data.alpaca.markets/v1beta3/crypto/us` | 24/7                      |

To add an instrument, add a row to `INSTRUMENTS` in `src/instruments.ts`.

## How it works

- Stocks and crypto each arrive on their own WebSocket, using Node's built-in `WebSocket`.
  `PriceFeed` merges the two into a single stream of ticks. Ticks from the same stream keep
  their order. Ticks from different streams can interleave in any order.
- Each connection goes through the same steps: it waits for `connected`, sends `auth`,
  waits for `authenticated`, then subscribes to `trades`. Each trade becomes one tick.
- Dropped connections and transient server errors are retried with exponential backoff,
  from 1 s up to a 30 s cap. The backoff resets once a connection authenticates again.
- Some errors can't be fixed by reconnecting, so they close both streams and are thrown:
  bad keys (401/402), the plan's symbol or connection limit (405/406), and a feed your plan
  doesn't include (409/410).

## Plan limits

The free Basic plan gives real-time stock data from the IEX exchange only. IEX is a small
share of US volume, so stock ticks are sparser than on the full tape. The plan allows 30
symbols and **one connection per endpoint**. If another client using the same keys is
already connected, the stream fails with error 406. Passing `stockFeed: "sip"` switches to
the all-exchange feed, which needs a paid plan. Keys from a paper-trading account work for
market data.

## Common commands

```bash
pnpm --filter @repo/alpaca test
pnpm --filter @repo/alpaca typecheck
```
