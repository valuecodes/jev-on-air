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
