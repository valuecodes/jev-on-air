# CLI

Command-line entry point for JevOnAir.
Arguments are parsed with Node's built-in `node:util` `parseArgs`.

## Stack

- Node.js 24 running TypeScript through [tsx](https://tsx.is) (no build step)
- Vitest for unit tests

## Getting started

From the repo root:

```bash
pnpm install
pnpm cli --hello-world   # Hello, world!
pnpm cli                 # usage
```

## Transcribe a YouTube stream

Needs [uv](https://docs.astral.sh/uv/) and `ffmpeg` on `PATH` (see
[`@repo/transcriber`](../../packages/transcriber/README.md)).

```bash
pnpm cli transcribe https://www.youtube.com/watch?v=U5Ovbz8KnYE
pnpm cli transcribe <url> --model medium --language en --chunk 5
pnpm cli transcribe <url> --realtime --json
```

Works for live streams (starting at the live edge) and finished videos. Transcript lines go
to stdout as `[hh:mm:ss] text` (or JSON lines with `--json`), and every segment is also
appended to `.cache/transcripts/<video-id>.jsonl` (`--out` to change it). Logs go to stderr.
`--realtime` paces a finished video like a live stream. Ctrl+C stops the whole pipeline.

## Stream live prices

Streams prices for Gold (`GLD`), Bitcoin (`BTC/USD`), S&P 500 (`SPY`) and Oil (`USO`) from
Alpaca (see [`@repo/alpaca`](../../packages/alpaca/README.md)). Copy `.env.example` to `.env`
at the repo root and fill in your Alpaca keys; a paper-trading account's keys work.

```bash
pnpm cli prices          # 14:31:07  Gold      GLD           243.10  trade
pnpm cli prices --json   # one JSON tick per line
```

Each line is a trade, or a quote update shown as its bid/ask midpoint (`mid`), printed when
the midpoint moves. Times are UTC exchange times. Bitcoin ticks around the clock; the ETFs
only during US market hours. Logs go to stderr, and Ctrl+C closes the streams.

## Paper-trade a stream with Jev

Runs the decision engine (see [`@repo/jev`](../../packages/jev/README.md)) over a live stream:
the transcript and live prices go in, TypeSafe AI's Jev model decides, and the fills land in a
simulated portfolio. Needs the Alpaca keys and `TYPESAFE_API_KEY` in `.env` (`JEV_MODEL` picks
the model; the default is `jev-latest`).

```bash
pnpm cli jev https://www.youtube.com/watch?v=U5Ovbz8KnYE --language en
pnpm cli jev <url> --interval 60 --size 0.05               # fewer, smaller trades
pnpm cli jev <url> --json                                  # ledger events as JSON lines
```

Every decision, fill, rejection, snapshot and error is printed and appended to
`.cache/jev/<video-id>.jsonl`. The portfolio itself lives in `.cache/jev/portfolio.json`, is
saved after every fill and picked up again by the next run; `--reset` starts over with `--cash`
and `--state` points at another file. A lock file next to it keeps two runs from trading the same
book at once. Live runs also save their transcript to
`.cache/transcripts/<video-id>.jsonl`, so any run can be replayed.

### Replay a recording

```bash
pnpm cli prices --json > ticks.jsonl                          # record prices for a while
pnpm cli jev --replay .cache/transcripts/<id>.jsonl           # saved transcript, live prices
pnpm cli jev --replay <transcript> --prices ticks.jsonl --fast --decider hold
pnpm cli jev --replay <transcript> --prices ticks.jsonl --fast --decider script:plan.jsonl
```

`--replay` paces the transcript by its own timestamps; with `--prices` it is fully offline and
`--fast` runs it without waiting on a virtual clock. `--decider hold` exercises the plumbing
without an API key; `script:<file>` replays one JSON decision object per line
(`{"decisions":[...],"signal":0.9}`). A replay uses a scratch portfolio under
`.cache/jev/replay/` unless `--state` says otherwise, so it never trades on top of the live book.
Run `pnpm cli` for the full option list.

The root `cli` script runs `pnpm --silent --filter cli start`, so any arguments after
`pnpm cli` are passed straight to `src/main.ts`.

## Common commands

| Task      | Command                       |
| --------- | ----------------------------- |
| Start     | `pnpm --filter cli start`     |
| Typecheck | `pnpm --filter cli typecheck` |
| Test      | `pnpm --filter cli test`      |
| Format    | `pnpm --filter cli format`    |
| Clean     | `pnpm --filter cli clean`     |

Linting is repo-wide: run `pnpm lint` from the root.
