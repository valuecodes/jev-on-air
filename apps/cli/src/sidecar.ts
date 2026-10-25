// The `.meta.json` next to a transcript: what video it came from and when
// its audio began, so a replay can line it up with recorded prices.

import type { VideoInfo } from "@repo/transcriber";
import { readFile, writeFile } from "node:fs/promises";

import { isZonedTime } from "./time";

type Sidecar = {
  video: VideoInfo;
  /** When transcription started, in wall-clock time. */
  transcribedAt: string;
  /**
   * Wall-clock time of the transcript's second zero, when known: a live
   * archive starts when its broadcast did. For a live transcription it is
   * when transcription started, which already includes the stream's delay
   * (so replaying such a transcript needs no `--lag`). A plain upload gives
   * no clue.
   */
  audioStart?: string;
};

/** `<transcript>.jsonl` → `<transcript>.meta.json`. */
const sidecarPath = (transcriptPath: string): string =>
  `${transcriptPath.replace(/\.jsonl$/, "")}.meta.json`;

const audioStartOf = (
  video: VideoInfo,
  transcribedAt: string
): string | undefined => {
  if (video.live === "was_live") {
    return video.startedAt;
  }
  if (video.live === "is_live") {
    return transcribedAt;
  }
  return undefined;
};

const buildSidecar = (video: VideoInfo, transcribedAt: string): Sidecar => {
  const audioStart = audioStartOf(video, transcribedAt);
  return {
    video,
    transcribedAt,
    ...(audioStart === undefined ? {} : { audioStart }),
  };
};

const writeSidecar = async (path: string, sidecar: Sidecar): Promise<void> => {
  await writeFile(path, `${JSON.stringify(sidecar, null, 2)}\n`);
};

/** The sidecar at `path`, or `undefined` when there is none. */
const readSidecar = async (path: string): Promise<Sidecar | undefined> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const value: unknown = JSON.parse(text);
  const fail = (): never => {
    throw new Error(`not a transcript sidecar: ${path}`);
  };
  if (typeof value !== "object" || value === null) {
    return fail();
  }
  const { video, transcribedAt, audioStart } = value as Record<string, unknown>;
  if (
    typeof video !== "object" ||
    video === null ||
    typeof (video as { title?: unknown }).title !== "string" ||
    typeof transcribedAt !== "string"
  ) {
    return fail();
  }
  if (
    audioStart !== undefined &&
    (typeof audioStart !== "string" || !isZonedTime(audioStart))
  ) {
    return fail();
  }
  return value as Sidecar;
};

export { buildSidecar, readSidecar, sidecarPath, writeSidecar };
export type { Sidecar };
