// The `.meta.json` next to a transcript: what video it came from and when
// its audio began, so a replay can line it up with recorded prices.
import { readFile, writeFile } from "node:fs/promises";
import type { VideoInfo } from "@repo/transcriber";

import { isZonedTime } from "./time";

export type Sidecar = {
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
export function sidecarPath(transcriptPath: string): string {
  return `${transcriptPath.replace(/\.jsonl$/, "")}.meta.json`;
}

export function buildSidecar(video: VideoInfo, transcribedAt: string): Sidecar {
  const audioStart =
    video.live === "was_live"
      ? video.startedAt
      : video.live === "is_live"
        ? transcribedAt
        : undefined;
  return {
    video,
    transcribedAt,
    ...(audioStart === undefined ? {} : { audioStart }),
  };
}

export async function writeSidecar(
  path: string,
  sidecar: Sidecar
): Promise<void> {
  await writeFile(path, `${JSON.stringify(sidecar, null, 2)}\n`);
}

/** The sidecar at `path`, or `undefined` when there is none. */
export async function readSidecar(path: string): Promise<Sidecar | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(text);
  const fail = (): never => {
    throw new Error(`not a transcript sidecar: ${path}`);
  };
  if (typeof value !== "object" || value === null) return fail();
  const { video, transcribedAt, audioStart } = value as Record<string, unknown>;
  if (
    typeof video !== "object" ||
    video === null ||
    typeof (video as { title?: unknown }).title !== "string" ||
    typeof transcribedAt !== "string"
  )
    return fail();
  if (
    audioStart !== undefined &&
    (typeof audioStart !== "string" || !isZonedTime(audioStart))
  )
    return fail();
  return value as Sidecar;
}
