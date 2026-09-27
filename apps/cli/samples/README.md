# Sample events

Recorded events for testing Jev's decisions end to end without a live stream, Alpaca keys or
a Whisper setup. Each sample is three files named after its id:

- `<id>.jsonl`: the transcript, from `pnpm cli transcribe`
- `<id>.meta.json`: its sidecar (the video, and when its audio began)
- `<id>.ticks.jsonl`: 1-minute Alpaca bars around the event, from `pnpm cli prices --json`

Desk lists them under **Sample events** (see `apps/desk/src/lib/samples.ts`). From a terminal:

```bash
pnpm cli jev --replay=samples/fomc-2026-09-16.jsonl \
  --prices=samples/fomc-2026-09-16.ticks.jsonl --fast --lag=20 --reset
```

## `fomc-2026-09-16`

The FOMC press conference of 16 Sep 2026: Chair Warsh after the first rate hike since 2023
(+25bp to 3.75–4.00%, statement at 18:00Z). Video:
[`ELU3u2Ny7r0`](https://www.youtube.com/watch?v=ELU3u2Ny7r0) (Federal Reserve, public
domain). The ticks cover 17:50Z–19:30Z.

The Fed's upload is trimmed, so yt-dlp reports no broadcast start. The sidecar's
`audioStart` was set by hand to the scheduled start, 18:30Z. Regenerate with:

```bash
pnpm cli transcribe https://www.youtube.com/watch?v=ELU3u2Ny7r0 --language=en \
  --out=samples/fomc-2026-09-16.jsonl
pnpm cli prices --from=2026-09-16T17:50:00Z --to=2026-09-16T19:30:00Z --json \
  | grep '^{' > samples/fomc-2026-09-16.ticks.jsonl   # drop any pnpm banner lines
# then add "audioStart": "2026-09-16T18:30:00.000Z" to samples/fomc-2026-09-16.meta.json
```
