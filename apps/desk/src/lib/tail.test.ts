import { appendFile, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileTailer, splitLines } from "./tail";
import type { TailLine } from "./tail";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jev-desk-tail-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("splitLines", () => {
  it("returns complete lines with their end offsets and keeps the rest", () => {
    const { lines, rest } = splitLines(
      Buffer.alloc(0),
      Buffer.from("a\n\nbc\nd"),
      10
    );
    expect(lines).toEqual([
      { text: "a", end: 12 },
      { text: "bc", end: 16 },
    ]);
    expect(rest.toString()).toBe("d");
  });

  it("decodes a UTF-8 character split across reads once it is whole", () => {
    const bytes = Buffer.from("€\n");
    const first = splitLines(Buffer.alloc(0), bytes.subarray(0, 2), 0);
    expect(first.lines).toEqual([]);
    const second = splitLines(first.rest, bytes.subarray(2), 0);
    expect(second.lines).toEqual([{ text: "€", end: 4 }]);
  });
});

function follow(path: string, from?: number) {
  const lines: TailLine[] = [];
  let resets = 0;
  const tailer = new FileTailer(path, {
    ...(from === undefined ? {} : { from }),
    onLines: (batch) => lines.push(...batch),
    onReset: () => resets++,
    onError: (error) => {
      throw error;
    },
  });
  return { tailer, lines, resets: () => resets };
}

describe("FileTailer", () => {
  it("waits for a missing file and reads it once created", async () => {
    const path = join(dir, "a.jsonl");
    const { tailer, lines } = follow(path);
    await tailer.sync();
    expect(lines).toEqual([]);
    await writeFile(path, '{"n":1}\n');
    await tailer.sync();
    expect(lines).toEqual([{ text: '{"n":1}', end: 8 }]);
  });

  it("holds a partial line until its newline arrives", async () => {
    const path = join(dir, "a.jsonl");
    await writeFile(path, '{"n":1}\n{"n"');
    const { tailer, lines } = follow(path);
    await tailer.sync();
    expect(lines.map((line) => line.text)).toEqual(['{"n":1}']);
    await appendFile(path, ":2}\n");
    await tailer.sync();
    expect(lines.map((line) => line.text)).toEqual(['{"n":1}', '{"n":2}']);
    expect(lines[1]?.end).toBe(16);
  });

  it("resumes from an offset without repeating lines", async () => {
    const path = join(dir, "a.jsonl");
    await writeFile(path, "one\ntwo\n");
    const { tailer, lines } = follow(path, 4);
    await tailer.sync();
    expect(lines).toEqual([{ text: "two", end: 8 }]);
  });

  it("starts over when the file is truncated", async () => {
    const path = join(dir, "a.jsonl");
    await writeFile(path, "one\ntwo\n");
    const { tailer, lines, resets } = follow(path);
    await tailer.sync();
    await truncate(path, 0);
    await appendFile(path, "new\n");
    await tailer.sync();
    expect(resets()).toBe(1);
    expect(lines.at(-1)).toEqual({ text: "new", end: 4 });
  });

  it("starts over when the file is replaced", async () => {
    const path = join(dir, "a.jsonl");
    await writeFile(path, "one\n");
    const { tailer, lines, resets } = follow(path);
    await tailer.sync();
    await rm(path);
    // Past the filesystem's timestamp tick, so the birth time differs.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(path, "replacement\n");
    await tailer.sync();
    expect(resets()).toBe(1);
    expect(lines.at(-1)).toEqual({ text: "replacement", end: 12 });
  });

  it("picks up appends through the watcher after start", async () => {
    const path = join(dir, "a.jsonl");
    const { tailer, lines } = follow(path);
    tailer.start();
    try {
      await writeFile(path, "one\n");
      await expect.poll(() => lines.length, { timeout: 3000 }).toBe(1);
      await appendFile(path, "two\n");
      await expect.poll(() => lines.length, { timeout: 3000 }).toBe(2);
    } finally {
      tailer.stop();
    }
  });
});
