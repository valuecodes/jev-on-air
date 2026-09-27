// Where in the YouTube video a transcript moment is. Transcript times count
// from when transcription started; the video counts from the broadcast's
// start (streams) or from zero (uploads).
import type { VideoMeta } from "./types";

/** A sidecar written this long after a run started belongs to it. */
const SIDECAR_WINDOW_MS = 2 * 60_000;

/**
 * Wall-clock time of the run's transcript second zero. The sidecar is
 * rewritten by every session, so it is only trusted when it was written
 * just after this run started; otherwise the run's start time is close.
 */
export function audioStartFor(
  meta: VideoMeta | null,
  runStart: string
): number | undefined {
  const started = Date.parse(runStart);
  const written = meta ? Date.parse(meta.transcribedAt) : Number.NaN;
  if (
    meta?.audioStart !== undefined &&
    written >= started &&
    written - started <= SIDECAR_WINDOW_MS
  )
    return Date.parse(meta.audioStart);
  return Number.isNaN(started) ? undefined : started;
}

/** Seconds into the video for a transcript time. */
export function videoTime(
  audioTime: number,
  meta: VideoMeta | null,
  runStart: string
): number {
  const broadcast = meta?.video.startedAt;
  if (!broadcast) return audioTime;
  const audioStart = audioStartFor(meta, runStart);
  if (audioStart === undefined) return audioTime;
  return Math.max(0, audioTime + (audioStart - Date.parse(broadcast)) / 1000);
}

export type SeekTarget =
  /** Seconds from the start of the video. */
  | { kind: "absolute"; seconds: number }
  /** A wall-clock moment on a live stream: seek back from the live edge. */
  | { kind: "live"; wallTime: number };

/**
 * How to seek to a transcript time. A stream that was live when transcribed
 * is sought relative to its live edge (its absolute time base can be months
 * old for a 24/7 stream); anything else by absolute video time.
 */
export function seekTarget(
  audioTime: number,
  meta: VideoMeta | null,
  runStart: string
): SeekTarget {
  const audioStart = audioStartFor(meta, runStart);
  if (meta?.video.live === "is_live" && audioStart !== undefined)
    return { kind: "live", wallTime: audioStart + audioTime * 1000 };
  return { kind: "absolute", seconds: videoTime(audioTime, meta, runStart) };
}
