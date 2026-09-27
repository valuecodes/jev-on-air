// The `transcribe` command: streams a YouTube transcript to stdout and appends
// every segment to a JSONL file, so a run can be replayed or tailed later. A
// `.meta.json` next to it records the video and when its audio began.
import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { LoggerLike } from "@repo/logger";
import { Transcriber } from "@repo/transcriber";

import { formatSegment } from "./cli";
import type { TranscribeArgs } from "./cli";
import { buildSidecar, sidecarPath, writeSidecar } from "./sidecar";
import type { Sidecar } from "./sidecar";
import { childEnv } from "./time";

const cacheDir = join(import.meta.dirname, "..", ".cache", "transcripts");

export class TranscribeCommand {
  private readonly logger: LoggerLike;

  constructor(logger: LoggerLike) {
    this.logger = logger;
  }

  async run(args: TranscribeArgs, signal?: AbortSignal): Promise<void> {
    // `pnpm cli` runs from apps/cli; INIT_CWD is where the user typed it.
    const out = args.out
      ? resolve(process.env.INIT_CWD ?? process.cwd(), args.out)
      : join(cacheDir, `${args.videoId}.jsonl`);
    await mkdir(dirname(out), { recursive: true });
    const transcriber = new Transcriber(this.logger, {
      model: args.model,
      language: args.language,
      chunkSeconds: args.chunkSeconds,
      realtime: args.realtime,
      env: childEnv(process.env),
    });
    const sidecar = await describeVideo(
      this.logger,
      transcriber,
      args.url,
      signal
    );
    if (signal?.aborted) return;

    const file = await open(out, "a");
    this.logger.info("writing transcript", { out });
    try {
      let described = false;
      for await (const segment of transcriber.transcribe(args.url, signal)) {
        const line = JSON.stringify(segment);
        await file.appendFile(`${line}\n`);
        // Only a session that produced a line gets to describe the file:
        // a failed restart must not re-date the previous session's lines.
        if (sidecar && !described) {
          described = true;
          await writeSidecar(sidecarPath(out), sidecar);
        }
        process.stdout.write(`${args.json ? line : formatSegment(segment)}\n`);
      }
    } finally {
      await file.close();
    }
  }
}

// Metadata is best effort; a stalled lookup must not hold up the audio.
const describeTimeoutMs = 30_000;

/**
 * The sidecar for a transcript of `url`, or `undefined` if the video could
 * not be described: that is logged, not fatal, since the transcript is worth
 * more than its metadata.
 */
export async function describeVideo(
  logger: LoggerLike,
  transcriber: Transcriber,
  url: string,
  signal?: AbortSignal
): Promise<Sidecar | undefined> {
  const limit = AbortSignal.any([
    AbortSignal.timeout(describeTimeoutMs),
    ...(signal ? [signal] : []),
  ]);
  try {
    const sidecar = buildSidecar(
      await transcriber.info(url, limit),
      new Date().toISOString()
    );
    logger.info("described video", {
      title: sidecar.video.title,
      live: sidecar.video.live,
      audioStart: sidecar.audioStart,
    });
    return sidecar;
  } catch (error) {
    if (signal?.aborted) return undefined;
    logger.warn(
      "could not describe the video; replays will need --audio-start",
      { err: error }
    );
    return undefined;
  }
}
