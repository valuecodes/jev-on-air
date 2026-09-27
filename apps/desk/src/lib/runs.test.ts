import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cliEnv,
  KILL_GRACE_MS,
  RunConflictError,
  RunRegistry,
  STOP_GRACE_MS,
} from "./runs";
import type { RunEvent } from "./runs";

class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
}

function setup() {
  const children: FakeChild[] = [];
  const argvs: string[][] = [];
  const kills: [number, NodeJS.Signals][] = [];
  const registry = new RunRegistry({
    spawn: (argv) => {
      argvs.push(argv);
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    killGroup: (pid, signal) => kills.push([pid, signal]),
    offsets: () => Promise.resolve({ ledger: 100, transcript: 50 }),
  });
  return { registry, children, argvs, kills };
}

const request = { videoId: "5vfaDsMhCF4", reset: false };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("RunRegistry", () => {
  it("starts the CLI and records where the run's lines begin", async () => {
    const { registry, children, argvs } = setup();
    const run = await registry.start(request);
    expect(run).toMatchObject({
      state: "starting",
      ledgerStart: 100,
      transcriptStart: 50,
    });
    expect(argvs[0]).toContain("https://www.youtube.com/watch?v=5vfaDsMhCF4");
    children[0]?.emit("spawn");
    expect(registry.list()[0]?.state).toBe("running");
  });

  it("refuses a second run while one is active, even when both start at once", async () => {
    const { registry } = setup();
    const results = await Promise.allSettled([
      registry.start(request),
      registry.start({ ...request, videoId: "aaaaaaaaaaa" }),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    expect(
      results[1]?.status === "rejected" && results[1].reason
    ).toBeInstanceOf(RunConflictError);
  });

  it("allows a new run once the last one has exited", async () => {
    const { registry, children } = setup();
    await registry.start(request);
    children[0]?.emit("spawn");
    children[0]?.emit("close", 1, null);
    expect(registry.list()[0]).toMatchObject({ state: "failed", exitCode: 1 });
    await expect(registry.start(request)).resolves.toMatchObject({
      state: "starting",
    });
  });

  it("stops with SIGTERM, again after the grace period, then SIGKILL", async () => {
    const { registry, children, kills } = setup();
    await registry.start(request);
    children[0]?.emit("spawn");
    expect(registry.stop()?.state).toBe("stopping");
    expect(kills).toEqual([[4242, "SIGTERM"]]);
    vi.advanceTimersByTime(STOP_GRACE_MS);
    expect(kills).toEqual([
      [4242, "SIGTERM"],
      [4242, "SIGTERM"],
    ]);
    vi.advanceTimersByTime(KILL_GRACE_MS);
    expect(kills.at(-1)).toEqual([4242, "SIGKILL"]);
  });

  it("marks a stopped run exited and cancels the escalation", async () => {
    const { registry, children, kills } = setup();
    await registry.start(request);
    children[0]?.emit("spawn");
    registry.stop();
    children[0]?.emit("close", null, "SIGTERM");
    vi.advanceTimersByTime(STOP_GRACE_MS + KILL_GRACE_MS);
    expect(kills).toHaveLength(1);
    expect(registry.list()[0]).toMatchObject({
      state: "exited",
      signal: "SIGTERM",
    });
  });

  it("signals a run stopped before its process spawned as soon as it does", async () => {
    const { registry, children, kills } = setup();
    await registry.start(request);
    registry.stop();
    expect(kills).toEqual([]);
    children[0]?.emit("spawn");
    expect(kills).toEqual([[4242, "SIGTERM"]]);
  });

  it("records a spawn failure", async () => {
    const { registry, children } = setup();
    await registry.start(request);
    children[0]?.emit("error", new Error("spawn node ENOENT"));
    expect(registry.list()[0]).toMatchObject({
      state: "failed",
      error: "spawn node ENOENT",
    });
  });

  it("buffers output and replays it to late subscribers", async () => {
    const { registry, children } = setup();
    await registry.start(request);
    children[0]?.stderr.write("missing TYPESAFE_API_KEY\n");
    await vi.waitFor(() => {
      const events: RunEvent[] = [];
      registry.subscribe(request.videoId, 0, (event) => events.push(event))();
      expect(events.at(-1)).toMatchObject({
        kind: "output",
        line: { stream: "stderr", text: "missing TYPESAFE_API_KEY" },
      });
    });
  });

  it("only forwards events for the subscribed video", async () => {
    const { registry } = setup();
    const events: RunEvent[] = [];
    const unsubscribe = registry.subscribe("aaaaaaaaaaa", 0, (event) =>
      events.push(event)
    );
    await registry.start(request);
    expect(events).toEqual([]);
    unsubscribe();
  });
});

describe("cliEnv", () => {
  it("drops what Next sets and keeps the rest", () => {
    expect(
      cliEnv({
        PATH: "/bin",
        ALPACA_API_KEY_ID: "k",
        NODE_ENV: "development",
        NODE_OPTIONS: "--inspect",
        NEXT_RUNTIME: "nodejs",
        __NEXT_PRIVATE_ORIGIN: "x",
        TURBOPACK: "1",
      })
    ).toEqual({ PATH: "/bin", ALPACA_API_KEY_ID: "k" });
  });
});
