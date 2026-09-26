# @repo/transcriber

Transcribes a YouTube live stream or video with
[faster-whisper](https://github.com/SYSTRAN/faster-whisper), yielding segments as they are
produced.

```ts
import { Transcriber } from "@repo/transcriber";

const transcriber = new Transcriber(logger, { model: "small", language: "en" });

for await (const segment of transcriber.transcribe(url, signal)) {
  segment; // { start: 337.13, end: 339.13, text: "Thank you." }
}
```

`start`/`end` are seconds from the start of the transcribed audio. Stop iterating or abort
`signal` to stop; a failing stage throws.

## How it works

```
yt-dlp → ffmpeg (16 kHz mono PCM) → whisper/transcribe.py → JSON line per segment
```

- **`src/transcriber.ts`** — `Transcriber` builds the three commands and parses the worker's
  JSON lines.
- **`src/pipeline.ts`** — `Pipeline` (also exported as `@repo/transcriber/pipeline`) runs
  commands connected stdout → stdin, logs each stage's stderr through the logger with a
  `stage` field, and stops every stage when iteration ends. Each stage leads its own process
  group, so stopping one also stops its descendants; stages that ignore SIGTERM (ffmpeg
  does, while blocked on input) are SIGKILLed after 2 s. Because of the process groups, a
  terminal Ctrl+C does not reach the stages directly: the caller handles SIGINT and aborts
  `signal`.
- **`whisper/`** — a uv project pinning `faster-whisper` and `yt-dlp`. `transcribe.py`
  buffers PCM from stdin and transcribes ~`chunkSeconds` windows, cutting each at the
  quietest 200 ms in its last 2 s so words are not split. It passes the tail of the previous
  text as the prompt, and locks the language after the first chunk with speech.

## Latency

Text trails speech by roughly the window length plus inference time — about 10–15 s with the
defaults, on top of YouTube's own live delay. A smaller `chunkSeconds` lowers it at some cost
to accuracy. If the worker logs that it is falling behind real time on a live stream, the
model is too big for the machine.

## Setup

Needs [uv](https://docs.astral.sh/uv/) and `ffmpeg` on `PATH`. `uv run` creates
`whisper/.venv` on first use; to do that ahead of time:

```bash
uv sync --project packages/transcriber/whisper
```

The first transcription downloads the whisper model (~500 MB for `small`) to the Hugging Face
cache.

## Common commands

| Task      | Command                                     |
| --------- | ------------------------------------------- |
| Typecheck | `pnpm --filter @repo/transcriber typecheck` |
| Test      | `pnpm --filter @repo/transcriber test`      |
| Format    | `pnpm --filter @repo/transcriber format`    |
