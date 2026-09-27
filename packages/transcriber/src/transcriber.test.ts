import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it } from "vitest";

import { parseSegmentLine, parseVideoInfo, Transcriber } from "./transcriber";

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

describe("parseVideoInfo", () => {
  it("reads the title, live status and broadcast start", () => {
    expect(
      parseVideoInfo(
        JSON.stringify({
          id: "H8FlQPYHGA4",
          title: "Site Visit",
          channel: "The White House",
          duration: 1055,
          was_live: true,
          live_status: "was_live",
          timestamp: 1790352795,
          release_timestamp: 1790350993,
        })
      )
    ).toEqual({
      id: "H8FlQPYHGA4",
      title: "Site Visit",
      channel: "The White House",
      durationSeconds: 1055,
      live: "was_live",
      startedAt: "2026-09-25T15:43:13.000Z",
    });
    expect(
      parseVideoInfo(
        JSON.stringify({ id: "x", title: "Upload", live_status: "not_live" })
      )
    ).toEqual({ id: "x", title: "Upload", live: "not_live" });
    expect(
      parseVideoInfo(
        JSON.stringify({ id: "x", title: "Live", live_status: "is_live" })
      ).live
    ).toBe("is_live");
  });

  it("throws on anything else", () => {
    expect(() => parseVideoInfo("[]")).toThrow(/not a video/);
    expect(() => parseVideoInfo('{"title": "no id"}')).toThrow(/not a video/);
    expect(() => parseVideoInfo("nope")).toThrow();
  });
});

describe("Transcriber.infoCommand", () => {
  it("asks yt-dlp for a description only", () => {
    const { logger } = createTestLogger();
    const command = new Transcriber(logger).infoCommand("https://youtu.be/x");
    expect(command.file).toBe("uv");
    expect(command.args).toEqual(
      expect.arrayContaining([
        "--dump-single-json",
        "--skip-download",
        "--",
        "https://youtu.be/x",
      ])
    );
    expect(command.args.at(-1)).toBe("https://youtu.be/x");
  });
});
