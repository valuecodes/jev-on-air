// Runs a chain of processes connected stdout -> stdin, like a shell pipeline,
// and yields the last stage's stdout line by line. Every stage is killed when
// the consumer stops iterating, the signal aborts, or any stage exits.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { LoggerLike } from "@repo/logger";

export type PipelineOptions = {
  /** Environment for the stages (default: this process's). */
  env?: NodeJS.ProcessEnv;
};

export type Command = {
  /** Label used in logs and error messages. */
  name: string;
  file: string;
  args: string[];
};

type Exit = {
  name: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

function waitForExit(name: string, child: ChildProcess): Promise<Exit> {
  return new Promise((resolve) => {
    child.once("error", (error) =>
      resolve({ name, code: null, signal: null, error })
    );
    child.once("close", (code, signal) => resolve({ name, code, signal }));
  });
}

function describeFailure(exit: Exit): string | undefined {
  if (exit.error) return `${exit.name} failed to run: ${exit.error.message}`;
  if (exit.code !== 0 && exit.code !== null)
    return `${exit.name} exited with code ${exit.code}`;
  if (exit.signal) return `${exit.name} was killed by ${exit.signal}`;
  return undefined;
}

/**
 * How long a stage gets to exit after SIGTERM before it is SIGKILLed. ffmpeg,
 * for one, restarts a blocked read after a single SIGTERM and would otherwise
 * never exit.
 */
const KILL_GRACE_MS = 2000;

/** Signals `child`'s whole process group; a group that is gone is ignored. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // ESRCH: every process in the group has already exited.
  }
}

/** Logs a stage's stderr line at the level its `ERROR:`/`WARNING:` prefix implies. */
function logStderrLine(logger: LoggerLike, line: string): void {
  if (/^error\b/i.test(line)) logger.error(line);
  else if (/^warning\b/i.test(line)) logger.warn(line);
  else logger.info(line);
}

export class Pipeline {
  private readonly logger: LoggerLike;
  private readonly env: NodeJS.ProcessEnv | undefined;

  constructor(logger: LoggerLike, options: PipelineOptions = {}) {
    this.env = options.env;
    this.logger = logger;
  }

  /** Runs `commands` as one pipeline, yielding the last stage's stdout lines. */
  async *run(
    commands: Command[],
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    if (commands.length === 0) throw new Error("pipeline has no commands");
    if (signal?.aborted) return;

    const children = commands.map((command) =>
      // Each stage leads its own process group so `signalGroup` also reaches
      // its descendants: `uv run` keeps a Python child that holds the stage's
      // stdout open after `uv` itself exits. The stages therefore do not get
      // a terminal Ctrl+C directly; abort `signal` to stop them.
      spawn(command.file, command.args, {
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
        env: this.env ?? process.env,
      })
    );
    const exits = children.map((child, index) =>
      waitForExit(commands[index]?.name ?? "process", child)
    );
    const running = new Set(children);
    // Stages we signalled; how they exit is our doing, not a failure.
    const stopped = new Set<ChildProcess>();
    let forceKill: NodeJS.Timeout | undefined;
    for (const child of children) {
      const done = () => {
        running.delete(child);
        if (running.size === 0) clearTimeout(forceKill);
      };
      // A stage that fails to spawn may emit only `error`, never `close`.
      child.once("error", done);
      child.once("close", done);
      // Once a stage's leader exits, anything left in its group can only be
      // holding its pipes open, which would stall `close` and the read loop
      // below. Stop it; bytes already written stay readable in the pipe. The
      // leader's exit code is still what gets reported.
      child.once("exit", () => {
        signalGroup(child, "SIGTERM");
        const reap = setTimeout(
          () => signalGroup(child, "SIGKILL"),
          KILL_GRACE_MS
        );
        child.once("close", () => clearTimeout(reap));
      });
    }
    const killAll = () => {
      for (const child of running) {
        stopped.add(child);
        signalGroup(child, "SIGTERM");
      }
      if (running.size > 0 && forceKill === undefined) {
        forceKill = setTimeout(() => {
          for (const child of running) signalGroup(child, "SIGKILL");
        }, KILL_GRACE_MS);
      }
    };
    signal?.addEventListener("abort", killAll, { once: true });
    // The stages are not in our process group, so they would outlive us if we
    // exited mid-run (an uncaught exception, `process.exit`). `exit` handlers
    // must be synchronous, which `process.kill` is.
    const killOnExit = () => {
      for (const child of running) signalGroup(child, "SIGKILL");
    };
    process.once("exit", killOnExit);

    children.forEach((child, index) => {
      const stage = commands[index]?.name ?? "process";
      // A stage that dies closes its neighbours' pipes; that surfaces as its
      // own exit code, so the stream-level EPIPE errors are not interesting.
      child.stdin?.on("error", () => undefined);
      child.stdout?.on("error", () => undefined);
      if (child.stderr) {
        const stageLogger = this.logger.child({ stage });
        createInterface({ input: child.stderr }).on("line", (line) =>
          logStderrLine(stageLogger, line)
        );
      }
      const next = children[index + 1];
      if (next?.stdin && child.stdout) {
        child.stdout.pipe(next.stdin);
        // `pipe` only ends the next stdin on a clean end of this stdout; make
        // sure the next stage sees EOF however this one goes away.
        child.once("close", () => next.stdin?.end());
        // When the next stage goes away first, `pipe` unpipes and leaves this
        // stdout paused; it would then never reach EOF, so this stage would
        // never emit `close`. Drain it instead.
        next.once("close", () => child.stdout?.resume());
      }
    });
    // The first stage gets no input.
    children[0]?.stdin?.end();

    const last = children[children.length - 1];
    try {
      if (last?.stdout) {
        for await (const line of createInterface({
          input: last.stdout,
          crlfDelay: Infinity,
        })) {
          yield line;
        }
      }
      // The last stage is done; anything still running upstream has nowhere
      // to write to, so stop it rather than wait on it.
      await exits[exits.length - 1];
      killAll();
      const results = await Promise.all(exits);
      if (signal?.aborted) return;
      // Report the last stage first: when it crashes, upstream stages die of a
      // broken pipe, which is a symptom. When it exits cleanly, the earliest
      // failing stage is the root cause (a bad URL fails the first stage, and
      // the decoder then fails on empty input).
      const ordered = [children.length - 1, ...children.keys()];
      for (const index of ordered) {
        const child = children[index];
        const exit = results[index];
        if (!child || !exit || stopped.has(child)) continue;
        const failure = describeFailure(exit);
        if (failure) throw new Error(failure);
      }
    } finally {
      signal?.removeEventListener("abort", killAll);
      killAll();
      void Promise.all(exits).then(() => process.off("exit", killOnExit));
    }
  }
}
