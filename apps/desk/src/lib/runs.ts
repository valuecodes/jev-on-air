// Runs the CLI for the "New run" form: one run at a time, because every live
// run locks the shared paper portfolio for its whole life. Output is always
// drained into a ring buffer, so a slow or absent browser never stalls the CLI.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { cliDir, ledgerPath, transcriptPath } from "./paths";
import { jevArgv } from "./start";
import type { StartRequest } from "./start";
import type { OutputLine, RunState, RunSummary } from "./types";

/** The parts of a `ChildProcess` desk uses, so tests can fake one. */
export type ChildLike = {
  readonly pid?: number | undefined;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on(event: "spawn", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
};

export type RunEvent =
  { kind: "state"; run: RunSummary } | { kind: "output"; line: OutputLine };

export type RegistryDeps = {
  spawn: (argv: string[]) => ChildLike;
  /** Signals a whole process group. */
  killGroup: (pid: number, signal: NodeJS.Signals) => void;
  /** Current ledger and transcript sizes for a video. */
  offsets: (videoId: string) => Promise<{ ledger: number; transcript: number }>;
};

export class RunConflictError extends Error {}

const OUTPUT_LIMIT = 2000;
const LINE_LIMIT = 4000;
const HISTORY_LIMIT = 20;
/** The CLI's first signal aborts cleanly; give it this long to write `end`. */
export const STOP_GRACE_MS = 15_000;
/** Its second signal exits at once and reaps the transcriber; then SIGKILL. */
export const KILL_GRACE_MS = 5_000;

type Run = {
  summary: RunSummary;
  child: ChildLike | undefined;
  output: OutputLine[];
  stopRequested: boolean;
  timers: NodeJS.Timeout[];
};

export class RunRegistry {
  private readonly deps: RegistryDeps;
  private readonly runs: Run[] = [];
  private active: Run | undefined;
  /**
   * Identifies this registry, so a client whose output cursor came from an
   * earlier desk process (whose `seq` counted separately) starts over.
   */
  readonly generation = Date.now();
  private seq = 0;
  private readonly listeners = new Set<
    (videoId: string, event: RunEvent) => void
  >();

  constructor(deps: RegistryDeps) {
    this.deps = deps;
  }

  /** Desk's runs, newest first. */
  list(): RunSummary[] {
    return this.runs.map((run) => ({ ...run.summary })).reverse();
  }

  /** Starts a run. Throws `RunConflictError` while another one is active. */
  async start(request: StartRequest): Promise<RunSummary> {
    if (this.active)
      throw new RunConflictError(
        `a run is already active for ${this.active.summary.videoId}; stop it first`
      );
    // Claimed before the first await, so two requests cannot both start.
    const run: Run = {
      summary: {
        id: randomUUID(),
        videoId: request.videoId,
        startedAt: new Date().toISOString(),
        state: "starting",
        exitCode: null,
        signal: null,
        error: null,
        mode: request.sample?.mode ?? "live",
        ledgerStart: 0,
        transcriptStart: 0,
      },
      child: undefined,
      output: [],
      stopRequested: false,
      timers: [],
    };
    this.active = run;
    this.runs.push(run);
    if (this.runs.length > HISTORY_LIMIT) this.runs.shift();

    try {
      const offsets = await this.deps.offsets(request.videoId);
      run.summary.ledgerStart = offsets.ledger;
      run.summary.transcriptStart = offsets.transcript;
      if (run.stopRequested) {
        this.finish(run, "exited", null, null);
        return { ...run.summary };
      }
      run.child = this.deps.spawn(jevArgv(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish(run, "failed", null, null, message);
      return { ...run.summary };
    }

    const child = run.child;
    this.drain(run, child.stdout, "stdout");
    this.drain(run, child.stderr, "stderr");
    child.on("spawn", () => {
      if (run.stopRequested) this.signal(run);
      else if (run.summary.state === "starting")
        this.update(run, { state: "running" });
    });
    child.on("error", (error) =>
      this.finish(run, "failed", null, null, error.message)
    );
    child.on("close", (code, signal) =>
      this.finish(
        run,
        run.stopRequested || code === 0 ? "exited" : "failed",
        code,
        signal
      )
    );
    this.emit(run);
    return { ...run.summary };
  }

  /**
   * Stops the active run if it is `id`: SIGTERM, again after a grace period,
   * then SIGKILL. The id keeps a stale page from stopping a newer run.
   * Returns `undefined` if nothing is active; throws `RunConflictError` if
   * another run is.
   */
  stop(id: string): RunSummary | undefined {
    const run = this.active;
    if (!run) return undefined;
    if (run.summary.id !== id)
      throw new RunConflictError(
        `the active run is for ${run.summary.videoId}, not the one shown; reload`
      );
    if (!run.stopRequested) {
      run.stopRequested = true;
      if (run.summary.state === "running") this.signal(run);
      else this.update(run, { state: "stopping" });
    }
    return { ...run.summary };
  }

  /**
   * Streams a video's run events: first the state and buffered output of
   * desk's latest run for it (after `after.seq`, if the cursor is from this
   * registry), then everything live.
   */
  subscribe(
    videoId: string,
    after: { generation: number; seq: number },
    listener: (event: RunEvent) => void
  ): () => void {
    const afterSeq = after.generation === this.generation ? after.seq : 0;
    const latest = this.runs.findLast((run) => run.summary.videoId === videoId);
    if (latest) {
      listener({ kind: "state", run: { ...latest.summary } });
      for (const line of latest.output)
        if (line.seq > afterSeq) listener({ kind: "output", line });
    }
    const forward = (id: string, event: RunEvent): void => {
      if (id === videoId) listener(event);
    };
    this.listeners.add(forward);
    return () => this.listeners.delete(forward);
  }

  /** Asks every run desk owns to stop; used when desk itself exits. */
  shutdown(): void {
    for (const run of this.runs) {
      const pid = run.child?.pid;
      if (
        pid !== undefined &&
        (run.summary.state === "running" || run.summary.state === "stopping")
      )
        this.kill(pid, "SIGTERM");
    }
  }

  private signal(run: Run): void {
    const pid = run.child?.pid;
    this.update(run, { state: "stopping" });
    if (pid === undefined) return;
    this.kill(pid, "SIGTERM");
    const escalate = setTimeout(() => {
      this.kill(pid, "SIGTERM");
      const kill = setTimeout(() => this.kill(pid, "SIGKILL"), KILL_GRACE_MS);
      kill.unref();
      run.timers.push(kill);
    }, STOP_GRACE_MS);
    escalate.unref();
    run.timers.push(escalate);
  }

  private kill(pid: number, signal: NodeJS.Signals): void {
    try {
      this.deps.killGroup(pid, signal);
    } catch (error) {
      // Already gone.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  private drain(
    run: Run,
    stream: Readable | null,
    name: OutputLine["stream"]
  ): void {
    if (!stream) return;
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    lines.on("line", (text) => {
      const line: OutputLine = {
        generation: this.generation,
        seq: ++this.seq,
        stream: name,
        text: text.length > LINE_LIMIT ? `${text.slice(0, LINE_LIMIT)}…` : text,
      };
      run.output.push(line);
      if (run.output.length > OUTPUT_LIMIT) run.output.shift();
      this.broadcast(run.summary.videoId, { kind: "output", line });
    });
  }

  private finish(
    run: Run,
    state: Extract<RunState, "exited" | "failed">,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    error: string | null = null
  ): void {
    if (run.summary.state === "exited" || run.summary.state === "failed")
      return;
    for (const timer of run.timers) clearTimeout(timer);
    run.timers = [];
    if (this.active === run) this.active = undefined;
    this.update(run, { state, exitCode, signal, error });
  }

  private update(run: Run, patch: Partial<RunSummary>): void {
    Object.assign(run.summary, patch);
    this.emit(run);
  }

  private emit(run: Run): void {
    this.broadcast(run.summary.videoId, {
      kind: "state",
      run: { ...run.summary },
    });
  }

  private broadcast(videoId: string, event: RunEvent): void {
    for (const listener of this.listeners) listener(videoId, event);
  }
}

async function size(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

/**
 * The environment for the CLI: desk's own, minus what Next sets for itself
 * (`NODE_ENV` included — it changes the logger's level). The CLI reads the
 * repo's `.env` on its own, exactly as from a terminal.
 */
export function cliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const key of Object.keys(result))
    if (
      key === "NODE_OPTIONS" ||
      key === "NODE_ENV" ||
      key.startsWith("NEXT_") ||
      key.startsWith("__NEXT") ||
      key.startsWith("TURBOPACK")
    )
      delete result[key];
  return result;
}

const defaultDeps: RegistryDeps = {
  spawn: (argv) =>
    spawn(process.execPath, argv, {
      cwd: cliDir,
      env: cliEnv(process.env),
      // Its own process group, so a stop signal reaches the CLI and nothing else.
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  killGroup: (pid, signal) => process.kill(-pid, signal),
  offsets: async (videoId) => ({
    ledger: await size(ledgerPath(videoId)),
    transcript: await size(transcriptPath(videoId)),
  }),
};

// On globalThis so Next's dev reloads keep the running process's handle.
const store = globalThis as typeof globalThis & { jevDeskRuns?: RunRegistry };

/** The process-wide registry. */
export function runs(): RunRegistry {
  if (!store.jevDeskRuns) {
    const registry = new RunRegistry(defaultDeps);
    store.jevDeskRuns = registry;
    process.once("exit", () => registry.shutdown());
  }
  return store.jevDeskRuns;
}
