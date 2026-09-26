import { createTestLogger } from "@repo/logger/testing";
import { describe, expect, it } from "vitest";

import { Pipeline } from "./pipeline";
import type { Command } from "./pipeline";

const node = (name: string, script: string): Command => ({
  name,
  file: process.execPath,
  args: ["-e", script],
});

const upper = node(
  "upper",
  "process.stdin.on('data', d => process.stdout.write(d.toString().toUpperCase()))"
);
const endless = node("source", "setInterval(() => console.log('x'), 10)");

async function collect(
  pipeline: Pipeline,
  commands: Command[],
  signal?: AbortSignal
) {
  const lines: string[] = [];
  for await (const line of pipeline.run(commands, signal)) lines.push(line);
  return lines;
}

describe("Pipeline", () => {
  it("pipes each stage into the next and yields lines", async () => {
    const { logger } = createTestLogger();
    const lines = await collect(new Pipeline(logger), [
      node("source", "console.log('a'); console.log('b')"),
      upper,
    ]);
    expect(lines).toEqual(["A", "B"]);
  });

  it("logs stderr lines with the stage and a level from their prefix", async () => {
    const { logger, lines } = createTestLogger();
    await collect(new Pipeline(logger), [
      node(
        "source",
        "console.error('warming up'); console.error('WARNING: slow'); console.error('ERROR: bad')"
      ),
      upper,
    ]);
    expect(
      lines.map(({ stage, severity, message }) => ({
        stage,
        severity,
        message,
      }))
    ).toEqual([
      { stage: "source", severity: "INFO", message: "warming up" },
      { stage: "source", severity: "WARNING", message: "WARNING: slow" },
      { stage: "source", severity: "ERROR", message: "ERROR: bad" },
    ]);
  });

  it("reports the failing upstream stage", async () => {
    const { logger } = createTestLogger();
    await expect(
      collect(new Pipeline(logger), [node("source", "process.exit(3)"), upper])
    ).rejects.toThrow("source exited with code 3");
  });

  it("reports a crash of the last stage before its broken-pipe fallout", async () => {
    const { logger } = createTestLogger();
    await expect(
      collect(new Pipeline(logger), [endless, node("sink", "process.exit(2)")])
    ).rejects.toThrow("sink exited with code 2");
  });

  it("force-kills a stage that ignores SIGTERM", async () => {
    const { logger } = createTestLogger();
    const stubborn = node(
      "stubborn",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
    );
    const lines = await collect(new Pipeline(logger), [
      stubborn,
      node("sink", "console.log('done')"),
    ]);
    expect(lines).toEqual(["done"]);
  });

  it("stops grandchildren that keep a stage's stdout open", async () => {
    const { logger } = createTestLogger();
    // The stage exits at once but leaves a child holding its stdout, the way
    // `uv run` leaves its Python process behind.
    const leaky = node(
      "leaky",
      "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] }); process.exit(0)"
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    await collect(new Pipeline(logger), [leaky, upper], controller.signal);
  });

  it("finishes when the last stage exits but a descendant keeps its stdout", async () => {
    const { logger } = createTestLogger();
    // No abort: the leader prints, exits, and leaves a child holding stdout.
    const leakySink = node(
      "sink",
      "process.stdin.resume(); console.log('done'); require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] }); setTimeout(() => process.exit(0), 50)"
    );
    const lines = await collect(new Pipeline(logger), [
      node("source", "console.log('x')"),
      leakySink,
    ]);
    expect(lines).toEqual(["done"]);
  });

  it("finishes aborting when a stage's stdout is stalled on backpressure", async () => {
    const { logger } = createTestLogger();
    // `sink` never reads, so `flood` fills the pipe and its stdout is paused.
    // `sink` also ignores SIGTERM, so like ffmpeg it only dies at the SIGKILL
    // escalation, well after `flood` has exited.
    const flood = node(
      "flood",
      "const b = Buffer.alloc(65536, 120); (function w() { process.stdout.write(b, w); })()"
    );
    const sink = node(
      "sink",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    await collect(new Pipeline(logger), [flood, sink], controller.signal);
  });

  it("reports a command that cannot be started", async () => {
    const { logger } = createTestLogger();
    await expect(
      collect(new Pipeline(logger), [
        { name: "missing", file: "definitely-not-a-command", args: [] },
      ])
    ).rejects.toThrow("missing failed to run");
  });

  it("stops every stage when the consumer breaks", async () => {
    const { logger } = createTestLogger();
    for await (const line of new Pipeline(logger).run([endless, upper])) {
      expect(line).toBe("X");
      break;
    }
    // Reaching here without hanging means the endless source was killed.
  });

  it("ends quietly when the signal aborts", async () => {
    const { logger } = createTestLogger();
    const controller = new AbortController();
    const lines: string[] = [];
    for await (const line of new Pipeline(logger).run(
      [endless, upper],
      controller.signal
    )) {
      lines.push(line);
      controller.abort();
    }
    expect(lines[0]).toBe("X");
  });
});
