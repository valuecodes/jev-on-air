import { describe, expect, it } from "vitest";

import {
  formatSegment,
  parseTranscribeArgs,
  parseYoutubeVideoId,
  run,
  usage,
} from "./cli.ts";

describe("run", () => {
  it("prints a greeting for --hello-world", () => {
    expect(run(["--hello-world"])).toBe("Hello, world!");
  });

  it("greets the given --name", () => {
    expect(run(["--hello-world", "--name=test"])).toBe("Hello, test!");
    expect(run(["--hello-world", "--name", "test"])).toBe("Hello, test!");
  });

  it("prints usage with no arguments", () => {
    expect(run([])).toBe(usage);
  });

  it("prints usage for --help and -h", () => {
    expect(run(["--help"])).toBe(usage);
    expect(run(["-h"])).toBe(usage);
  });

  it("throws on an unknown flag", () => {
    expect(() => run(["--nope"])).toThrow();
  });
});

describe("parseYoutubeVideoId", () => {
  it("reads watch, live, shorts and youtu.be URLs", () => {
    expect(
      parseYoutubeVideoId("https://www.youtube.com/watch?v=H8FlQPYHGA4")
    ).toBe("H8FlQPYHGA4");
    expect(parseYoutubeVideoId("https://youtube.com/live/H8FlQPYHGA4")).toBe(
      "H8FlQPYHGA4"
    );
    expect(
      parseYoutubeVideoId("https://m.youtube.com/shorts/H8FlQPYHGA4?si=x")
    ).toBe("H8FlQPYHGA4");
    expect(parseYoutubeVideoId("https://youtu.be/H8FlQPYHGA4")).toBe(
      "H8FlQPYHGA4"
    );
  });

  it("rejects other hosts, schemes and malformed IDs", () => {
    expect(() =>
      parseYoutubeVideoId("https://example.com/watch?v=H8FlQPYHGA4")
    ).toThrow(/not a YouTube URL/);
    expect(() =>
      parseYoutubeVideoId("file://youtube.com/watch?v=H8FlQPYHGA4")
    ).toThrow(/not a YouTube URL/);
    expect(() =>
      parseYoutubeVideoId("https://www.youtube.com/watch?v=../../etc")
    ).toThrow(/no YouTube video ID/);
    expect(() => parseYoutubeVideoId("--exec=rm")).toThrow(/not a URL/);
  });
});

describe("parseTranscribeArgs", () => {
  const url = "https://www.youtube.com/watch?v=H8FlQPYHGA4";

  it("parses the URL and defaults", () => {
    expect(parseTranscribeArgs([url])).toEqual({
      url,
      videoId: "H8FlQPYHGA4",
      model: undefined,
      language: undefined,
      chunkSeconds: undefined,
      realtime: false,
      json: false,
      out: undefined,
    });
  });

  it("parses options", () => {
    expect(
      parseTranscribeArgs([
        url,
        "--model=medium",
        "--language",
        "en",
        "--chunk=5",
        "--realtime",
        "--json",
        "--out=t.jsonl",
      ])
    ).toMatchObject({
      model: "medium",
      language: "en",
      chunkSeconds: 5,
      realtime: true,
      json: true,
      out: "t.jsonl",
    });
  });

  it("rejects missing or extra URLs, bad chunks and unknown flags", () => {
    expect(() => parseTranscribeArgs([])).toThrow(/needs a YouTube URL/);
    expect(() => parseTranscribeArgs([url, url])).toThrow(/unexpected/);
    expect(() => parseTranscribeArgs([url, "--chunk=2"])).toThrow(/--chunk/);
    expect(() => parseTranscribeArgs([url, "--chunk=abc"])).toThrow(/--chunk/);
    expect(() => parseTranscribeArgs([url, "--nope"])).toThrow();
  });
});

describe("formatSegment", () => {
  it("prefixes the text with an hh:mm:ss start time", () => {
    expect(formatSegment({ start: 3725.9, end: 3727, text: "hi" })).toBe(
      "[01:02:05] hi"
    );
  });
});
