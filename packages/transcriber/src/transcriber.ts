// Transcribes a YouTube live stream or video with faster-whisper. The audio is
// pulled by yt-dlp, decoded by ffmpeg and transcribed by the Python worker in
// `whisper/`; this class wires them together and yields segments as they come.
import { join } from "node:path";
import type { LoggerLike } from "@repo/logger";

import { Pipeline } from "./pipeline.ts";
import type { Command } from "./pipeline.ts";

export type Segment = {
  /** Seconds from the start of the transcribed audio. */
  start: number;
  end: number;
  text: string;
};

export type TranscriberOptions = {
  /** faster-whisper model name or path (default `small`). */
  model?: string;
  /** Spoken language code such as `en`; detected from the first speech if unset. */
  language?: string;
  /** Target seconds of audio per transcription window (default 8). */
  chunkSeconds?: number;
  /** Decode at playback speed, so a finished video behaves like a live stream. */
  realtime?: boolean;
};

const whisperDir = join(import.meta.dirname, "..", "whisper");

/** Parses one JSON line from the worker. Throws if it is not a segment. */
export function parseSegmentLine(line: string): Segment {
  const value: unknown = JSON.parse(line);
  if (
    typeof value === "object" &&
    value !== null &&
    "start" in value &&
    "end" in value &&
    "text" in value &&
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.text === "string"
  ) {
    return { start: value.start, end: value.end, text: value.text };
  }
  throw new Error(`not a transcript segment: ${line}`);
}

export class Transcriber {
  private readonly logger: LoggerLike;
  private readonly options: TranscriberOptions;
  private readonly pipeline: Pipeline;

  constructor(logger: LoggerLike, options: TranscriberOptions = {}) {
    this.logger = logger;
    this.options = options;
    this.pipeline = new Pipeline(logger);
  }

  /** The yt-dlp → ffmpeg → worker commands for `url`. */
  commands(url: string): Command[] {
    const { model, language, chunkSeconds, realtime } = this.options;
    const uv = ["run", "--project", whisperDir, "--quiet"];
    const worker = [join(whisperDir, "transcribe.py")];
    if (model !== undefined) worker.push("--model", model);
    if (language !== undefined) worker.push("--language", language);
    if (chunkSeconds !== undefined)
      worker.push("--chunk", String(chunkSeconds));

    return [
      {
        name: "yt-dlp",
        file: "uv",
        args: [
          ...uv,
          "yt-dlp",
          "--quiet",
          "--no-warnings",
          "--no-playlist",
          "--js-runtimes",
          "node",
          "--format",
          "bestaudio/best",
          "--output",
          "-",
          // `--` so a URL can never be read as an option.
          "--",
          url,
        ],
      },
      {
        name: "ffmpeg",
        file: "ffmpeg",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          ...(realtime ? ["-re"] : []),
          "-i",
          "pipe:0",
          "-vn",
          "-f",
          "s16le",
          "-ac",
          "1",
          "-ar",
          "16000",
          "pipe:1",
        ],
      },
      { name: "whisper", file: "uv", args: [...uv, "python", ...worker] },
    ];
  }

  /**
   * Yields transcript segments of `url` as they are produced. Stop iterating
   * or abort `signal` to stop the pipeline; a failing stage throws.
   */
  async *transcribe(
    url: string,
    signal?: AbortSignal
  ): AsyncGenerator<Segment> {
    this.logger.info("transcription started", { url, ...this.options });
    let segments = 0;
    for await (const line of this.pipeline.run(this.commands(url), signal)) {
      segments += 1;
      yield parseSegmentLine(line);
    }
    this.logger.info(
      signal?.aborted ? "transcription stopped" : "transcription finished",
      { url, segments }
    );
  }
}
