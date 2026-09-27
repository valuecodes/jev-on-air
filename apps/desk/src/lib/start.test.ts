import { describe, expect, it } from "vitest";

import { formatCursor, parseCursor } from "./cursor";
import { jevArgv, parseStartRequest } from "./start";

describe("parseStartRequest", () => {
  it("takes the video id from any YouTube URL form", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=5vfaDsMhCF4&t=10",
      "https://youtu.be/5vfaDsMhCF4",
      "https://www.youtube.com/live/5vfaDsMhCF4",
    ])
      expect(parseStartRequest({ url })).toEqual({
        videoId: "5vfaDsMhCF4",
        reset: false,
      });
  });

  it("keeps the options that were given", () => {
    expect(
      parseStartRequest({
        url: "https://youtu.be/5vfaDsMhCF4",
        size: 0.25,
        minSignal: 0,
        reset: true,
      })
    ).toEqual({
      videoId: "5vfaDsMhCF4",
      size: 0.25,
      minSignal: 0,
      reset: true,
    });
  });

  it("rejects anything that is not a YouTube video URL", () => {
    for (const url of [
      "",
      "--reset",
      "https://example.com/watch?v=5vfaDsMhCF4",
      "file:///etc/passwd",
      "https://www.youtube.com/watch?v=short",
    ])
      expect(() => parseStartRequest({ url })).toThrow();
  });

  it("rejects out-of-range options, wrong types and unknown fields", () => {
    const url = "https://youtu.be/5vfaDsMhCF4";
    for (const body of [
      { url, size: 0 },
      { url, size: 1.5 },
      { url, minSignal: -0.1 },
      { url, minSignal: "0.5" },
      { url, reset: "yes" },
      { url, state: "/tmp/other.json" },
      null,
      "https://youtu.be/5vfaDsMhCF4",
    ])
      expect(() => parseStartRequest(body)).toThrow();
  });
});

describe("jevArgv", () => {
  it("runs the CLI's jev command on the canonical URL", () => {
    expect(jevArgv({ videoId: "5vfaDsMhCF4", reset: false })).toEqual([
      "--import",
      "tsx",
      "src/main.ts",
      "jev",
      "https://www.youtube.com/watch?v=5vfaDsMhCF4",
    ]);
  });

  it("passes only the options that were set", () => {
    expect(
      jevArgv({
        videoId: "5vfaDsMhCF4",
        size: 0.2,
        minSignal: 0.7,
        reset: true,
      }).slice(5)
    ).toEqual(["--size=0.2", "--min-signal=0.7", "--reset"]);
  });
});

describe("parseCursor", () => {
  it("round-trips and treats junk as zero", () => {
    const cursor = {
      ledger: 12,
      transcript: 3,
      generation: 1790000000000,
      output: 7,
    };
    expect(parseCursor(formatCursor(cursor))).toEqual(cursor);
    const zero = { ledger: 0, transcript: 0, generation: 0, output: 0 };
    expect(parseCursor(null)).toEqual(zero);
    expect(parseCursor("x.-1.1e3.")).toEqual(zero);
  });
});
