# desk

A local dashboard for Jev: start and stop `jev` runs, and watch the transcript, decisions,
fills and portfolio as they happen.

```bash
pnpm desk        # http://127.0.0.1:3000
```

It needs whatever `pnpm cli jev` needs (keys in the root `.env`, uv, ffmpeg) — desk runs
that same CLI.

## How it works

- **Reads the CLI's files.** Each run page follows `apps/cli/.cache/jev/<id>.jsonl` (the
  ledger) and `apps/cli/.cache/transcripts/<id>.jsonl` over server-sent events. Runs started
  from a terminal show up too, marked `live · external`.
- **Video and prices.** The run page embeds the YouTube stream and charts the prices the run
  saw, from the tick file live runs record in `apps/cli/.cache/prices/<id>.jsonl` (downsampled
  to one point per second, as % change since the run started, with its fills marked). Clicking
  a transcript line's or decision's time seeks the video there: from the live edge on a live
  stream, by broadcast time on an archive.
- **Starts the CLI.** The form runs `node --import tsx src/main.ts jev <url>` in `apps/cli`,
  in its own process group. Stop sends SIGTERM, which the CLI turns into a clean abort (the
  ledger ends with `"aborted"`); a second SIGTERM after 15 s and SIGKILL after 5 s more back
  it up. Its output is kept so start-up errors show on the run page.
- **One run at a time.** Every live run locks the shared `portfolio.json`; a run started
  from a terminal holds that lock too, so a desk start then fails with the CLI's lock error.
- **Transcript matching.** The transcript file is appended by every session for a video. A
  run desk started is matched exactly by the byte offsets it recorded; others are matched to
  a session by order and labelled _approximate_.

## Local only

Desk starts processes that spend API credits and trade the shared paper portfolio. It binds
to `127.0.0.1`, answers only requests whose `Host` is localhost (DNS rebinding), and accepts
start/stop only as same-origin `application/json` posts (cross-site forms). Do not expose it
on a network.
