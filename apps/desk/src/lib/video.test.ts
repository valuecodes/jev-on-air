import { describe, expect, it } from "vitest";

import type { VideoMeta } from "./types";
import { audioStartFor, seekTarget, videoTime } from "./video";

const runStart = "2026-09-27T07:00:00.000Z";

const meta = (
  overrides: Partial<VideoMeta["video"]>,
  transcribedAt: string,
  audioStart?: string
): VideoMeta => ({
  video: { id: "5vfaDsMhCF4", ...overrides },
  transcribedAt,
  ...(audioStart === undefined ? {} : { audioStart }),
});

describe("audioStartFor", () => {
  it("trusts a sidecar written just after the run started", () => {
    const m = meta({}, "2026-09-27T07:00:03.000Z", "2026-09-27T07:00:03.000Z");
    expect(audioStartFor(m, runStart)).toBe(
      Date.parse("2026-09-27T07:00:03.000Z")
    );
  });

  it("falls back to the run start for another session's sidecar", () => {
    const m = meta({}, "2026-09-27T09:00:00.000Z", "2026-09-27T09:00:00.000Z");
    expect(audioStartFor(m, runStart)).toBe(Date.parse(runStart));
    expect(audioStartFor(null, runStart)).toBe(Date.parse(runStart));
  });
});

describe("videoTime", () => {
  it("is the transcript time for an upload", () => {
    expect(videoTime(42, meta({ live: "not_live" }, runStart), runStart)).toBe(
      42
    );
    expect(videoTime(42, null, runStart)).toBe(42);
  });

  it("is the transcript time for an archive transcribed from its start", () => {
    const start = "2026-09-26T12:00:00.000Z";
    const m = meta(
      { live: "was_live", startedAt: start },
      "2026-09-27T07:00:01.000Z",
      start
    );
    expect(videoTime(42, m, runStart)).toBe(42);
  });

  it("adds how far into the broadcast transcription began", () => {
    const m = meta(
      { live: "was_live", startedAt: "2026-09-27T06:00:00.000Z" },
      "2026-09-27T07:00:01.000Z",
      "2026-09-27T07:00:00.000Z"
    );
    expect(videoTime(10, m, runStart)).toBe(3610);
  });
});

describe("seekTarget", () => {
  it("seeks back from the live edge on a stream that was live", () => {
    const m = meta(
      { live: "is_live", startedAt: "2025-04-10T14:12:36.000Z" },
      "2026-09-27T07:00:02.000Z",
      "2026-09-27T07:00:02.000Z"
    );
    expect(seekTarget(8, m, runStart)).toEqual({
      kind: "live",
      wallTime: Date.parse("2026-09-27T07:00:10.000Z"),
    });
  });

  it("seeks absolutely otherwise", () => {
    expect(seekTarget(8, null, runStart)).toEqual({
      kind: "absolute",
      seconds: 8,
    });
  });
});
