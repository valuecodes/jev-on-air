# CLI

Command-line entry point for JevOnAir.
Arguments are parsed with Node's built-in `node:util` `parseArgs`.

## Stack

- Node.js 24 running TypeScript directly (type stripping, no build step)
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
