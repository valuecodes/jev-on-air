# @repo/jev

Jev is the paper-trading decision engine: it reads the live transcript, asks
[TypeSafe AI](https://typesafe.ai)'s Jev model what to do about Gold, Bitcoin, the S&P 500
and Oil, and applies the answer to a simulated portfolio kept in this repo. Alpaca only
supplies prices; nothing is ever sent to a broker.

```ts
import { Engine } from "@repo/jev/engine";
import { fractionOfEquity, Portfolio } from "@repo/jev/portfolio";
import { TypeSafeDecider } from "@repo/jev/typesafe";

const engine = new Engine(logger, {
  events, // merged transcript segments, price ticks and heartbeats
  decider: new TypeSafeDecider(logger, { apiKey }),
  portfolio: new Portfolio({ cash: 100_000, sizer: fractionOfEquity(0.1) }),
  trigger: { minChars: 400, maxWaitMs: 30_000 },
  onEvent: (event) => ledger.append(event),
  run,
  source,
  model,
  size: 0.1,
  resumed: false,
});
const final = await engine.run(signal);
```

There is no index module; import from the subpaths listed in `package.json`. The CLI command
that wires everything together lives in [`apps/cli`](../../apps/cli/README.md).

## How a run works

- **Events.** `merge` (`./merge`) combines the transcript, the price feed and a one-second
  heartbeat into one stream. The transcript is the primary source: when it ends, the run ends.
- **Trigger.** New transcript lines pile up in a buffer. The model is asked once the buffer holds
  `minChars` characters, or once the oldest unsent line has waited `maxWaitMs`, and never while a
  call is in flight. The heartbeat makes the time rule fire even when no ticks arrive.
- **Questions.** Jev is a System One model: it answers typed questions about a state and writes
  no prose. `./questions` builds the state each turn (the new lines, a few minutes of earlier
  lines, prices, the book and recent fills and rejections, since the model remembers nothing
  between calls) and asks one `choice` question per instrument, offering only the actions the
  book would accept for its current position, plus a yes/no gate: did the new lines hold a
  market-moving statement? Each instrument question also lists how news usually reaches the
  instruments (a hawkish Fed weighs on stocks, gold and bitcoin; supply cuts lift oil), since a
  speaker rarely names what is traded. Each price also carries how its market is moving
  (`./market`: 5- and 15-minute returns, the 5-minute move in usual moves, volume against the
  past hour, the spread), so the model can tell news already priced in from news the market is
  still reacting to; the signal question is asked without it, so the gate reads the speech alone. `./typesafe` asks the gate first, then the instrument
  questions with that read in the state; with a flat book and a read below `minSignal` it stops
  after the gate, since every entry would be rejected. The answers become decisions, each with
  the model's confidence and probabilities, and the holds are kept with their odds too, so the
  ledger shows how close a quiet turn came to trading.
- **Execution.** Decisions are applied when the answer arrives, at the prices current then. An
  entry is rejected when the gate says no (`minSignal`); any decision is rejected below the
  confidence threshold, when the instrument has no price or a stale one, or when the book says
  no (see below). Exits are never gated. Every step is reported as a ledger event, and recent
  fills and rejections are shown to the model on the next turn.
- **Market rules.** `MarketTape` (`./market`) keeps an hour of one-minute buckets per instrument,
  keyed by the minute they end, so live trades and recorded bars line up; only ended minutes
  feed volatility and volume. An entry is rejected when the instrument already moved more than
  `maxChaseZ` usual 5-minute moves its way. `volatilityScaled` (`./portfolio`) sizes a fill so a
  usual 15-minute move costs a fixed fraction of equity. With `stopZ` or `takeProfitZ` set, the
  engine closes a position on its own once it has moved that many usual 15-minute moves
  (volatility at entry) from its average price: the `fill` carries `exit` and no confidence,
  and a decision still in flight for that instrument is rejected, since it was made for a book
  that no longer exists. `marketHistory` seeds the tape with ticks from before the run.
- **Failures.** Rate limits, connection problems and 5xx replies keep the lines and retry with
  exponential backoff. An answer the engine cannot use is logged and retried after a full
  interval; after three in a row the pending lines are dropped. Any other API error (a bad key,
  an unknown model, an invalid request) ends the run.

## Portfolio semantics

Every fill is sized to a fraction of current equity. Reversing is two steps: close first, and
the model is only ever offered the actions that apply.

| action | no position  | long                        | short                 |
| ------ | ------------ | --------------------------- | --------------------- |
| buy    | open a long  | add, re-averaging the entry | rejected: close first |
| sell   | rejected     | reduce by one unit, or exit | rejected: use close   |
| short  | open a short | rejected: close first       | add, re-averaging     |
| close  | rejected     | flatten, realise P&L        | flatten, realise P&L  |

Entries are also rejected when equity is not positive, when a long would need more cash than
there is, or when gross exposure after the fill would exceed equity times `maxLeverage`
(default 1: no leverage). Equity is cash plus long value minus short value.

## Ledger events

Each event carries `run` (the run's ISO start time), `time`, `audioTime` (seconds into the
audio at the last line consumed) and `turn`. Types: `start`, `decision`, `fill`, `reject`,
`snapshot`, `error` and `end`. `formatEvent` (`./ledger`) renders one terminal line per event.

## Replay

`./replay` turns a saved transcript (`pnpm cli transcribe`) and recorded ticks
(`pnpm cli prices --json`) into timelines, either paced by their own timestamps or merged as fast
as possible on a virtual clock. Without an origin both recordings are assumed to have started at
the same moment; `tickTimeline` takes the audio's start time to align a past window of prices
instead, and `segmentTimeline` takes a lag to stand in for a live stream's delay. A transcript
file appended across several sessions restarts at zero each time; only the last
session is replayed.

## Cost

Jev bills input tokens only, at a few cents per million. A turn sends a few thousand tokens, so
even a busy hour of roughly a hundred turns costs well under a cent. State is capped at 32k
tokens per call; the engine keeps well inside that by bounding the pending buffer and the
context window. Every `decision` event records token usage.

## Common commands

```bash
pnpm --filter @repo/jev test
pnpm --filter @repo/jev typecheck
```
