import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it } from "vitest";

import { parseSegmentLine, Transcriber } from "./transcriber";

describe("parseSegmentLine", () => {
  it("parses a worker segment line", () => {
    expect(
      parseSegmentLine('{"start": 1.5, "end": 3, "text": "hello"}')
    ).toEqual({ start: 1.5, end: 3, text: "hello" });
  });

  it("throws on lines that are not segments", () => {
    expect(() => parseSegmentLine('{"start": 1}')).toThrow(/not a transcript/);
    expect(() => parseSegmentLine("[1, 2]")).toThrow(/not a transcript/);
    expect(() => parseSegmentLine("not json")).toThrow();
  });
});

describe("Transcriber.commands", () => {
  const url = "https://www.youtube.com/watch?v=U5Ovbz8KnYE";
  const { logger } = createTestLogger();

  it("chains yt-dlp, ffmpeg and the worker", () => {
    const commands = new Transcriber(logger).commands(url);
    expect(commands.map((command) => command.name)).toEqual([
      "yt-dlp",
      "ffmpeg",
      "whisper",
    ]);
    expect(commands[0]?.args.slice(-2)).toEqual(["--", url]);
    expect(commands[1]?.args).not.toContain("-re");
  });

  it("passes options through", () => {
    const [, ffmpeg, worker] = new Transcriber(logger, {
      model: "medium",
      language: "en",
      chunkSeconds: 5,
      realtime: true,
    }).commands(url);
    expect(ffmpeg?.args).toContain("-re");
    expect(worker?.args.slice(-6)).toEqual([
      "--model",
      "medium",
      "--language",
      "en",
      "--chunk",
      "5",
    ]);
  });
});
