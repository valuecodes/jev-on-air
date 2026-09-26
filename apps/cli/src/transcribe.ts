// The `transcribe` command: streams a YouTube transcript to stdout and appends
// every segment to a JSONL file, so a run can be replayed or tailed later.
import { mkdir, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { LoggerLike } from "@repo/logger";
import { Transcriber } from "@repo/transcriber";

import { formatSegment } from "./cli";
import type { TranscribeArgs } from "./cli";

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
    const file = await open(out, "a");
    this.logger.info("writing transcript", { out });

    const transcriber = new Transcriber(this.logger, {
      model: args.model,
      language: args.language,
      chunkSeconds: args.chunkSeconds,
      realtime: args.realtime,
    });
    try {
      for await (const segment of transcriber.transcribe(args.url, signal)) {
        const line = JSON.stringify(segment);
        await file.appendFile(`${line}\n`);
        process.stdout.write(`${args.json ? line : formatSegment(segment)}\n`);
      }
    } finally {
      await file.close();
    }
  }
}
