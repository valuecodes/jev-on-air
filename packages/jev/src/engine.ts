// The loop: consumes merged transcript, price and heartbeat events, asks the
// decider when the trigger says so, applies its decisions to the portfolio
// at the prices current when the answer arrives, and reports every step as
// ledger events. No I/O of its own: persistence is the `onEvent` hook's job.
import type { LoggerLike } from "@repo/logger";
import type { Segment } from "@repo/transcriber";

import { DeciderError } from "./decider";
import type { DecideResult } from "./decider";
import type { EngineEvent, EngineOptions } from "./engine-options";
import { Executor } from "./executor";
import type { EventBase, JevEvent } from "./ledger";
import type { Snapshot } from "./portfolio";
import type { TurnInput } from "./questions";
import { normalizeTurnOutput } from "./schema";
import { TranscriptBuffer } from "./transcript-buffer";
import { shouldEvaluate } from "./trigger";

// After this many non-retryable failures in a row the pending lines go.
const maxRepeatedFailures = 3;
const maxBackoffMs = 300_000;

class Engine {
  private readonly logger: LoggerLike;
  private readonly options: EngineOptions;
  private readonly clock: () => number;
  private readonly transcript: TranscriptBuffer;
  private readonly executor: Executor;
  private turn = 0;
  private lastEvaluationAt = 0;
  private lastSnapshotAt = 0;
  private backoffUntil = 0;
  private transientFailures = 0;
  private repeatedFailures = 0;
  private inFlight: Promise<void> | undefined;
  private controller = new AbortController();
  private fatal: { error: unknown } | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(logger: LoggerLike, options: EngineOptions) {
    this.logger = logger.child({ component: "engine" });
    this.options = options;
    this.clock = options.clock ?? Date.now;
    this.transcript = new TranscriptBuffer(this.logger, options);
    this.executor = new Executor(options, {
      clock: this.clock,
      base: (turn) => this.base(turn),
      emit: (event) => this.emit(event),
      snapshotAt: (at) => {
        this.lastSnapshotAt = at;
      },
    });
  }

  /**
   * Runs until the event source ends or `signal` aborts, then settles any
   * call in flight, flushes what is pending (unless aborted) and resolves
   * with the final book. Throws if a source, the decider or `onEvent` fails.
   */
  async run(signal?: AbortSignal): Promise<Snapshot> {
    this.controller = new AbortController();
    const onAbort = (): void => {
      this.controller.abort();
    };
    if (signal?.aborted === true) {
      this.controller.abort();
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    const now = this.clock();
    this.lastEvaluationAt = now;
    this.lastSnapshotAt = now;
    const start = this.executor.snapshot();
    await this.emit({
      ...this.base(null),
      type: "start",
      source: this.options.source,
      model: this.options.model,
      cash: start.cash,
      equity: start.equity,
      size: this.options.size,
      resumed: this.options.resumed,
      strategy: {
        sizing: this.options.sizing ?? "fixed",
        maxChaseZ: this.executor.maxChaseZ(),
        stopZ: this.options.stopZ ?? 0,
        takeProfitZ: this.options.takeProfitZ ?? 0,
      },
    });

    // The abort listener stays until the run has settled: a call in flight
    // or the final flush must still be cancellable once the source has ended.
    try {
      let failure: { error: unknown } | undefined;
      try {
        for await (const event of this.options.events(this.controller.signal)) {
          this.handle(event);
          if (event.kind === "tick" && !this.fatal) {
            await this.executor.maybeExit(event.tick.instrument, this.turn);
          }
          await this.maybeSnapshot();
          await this.maybeEvaluate();
          if (this.fatal) {
            break;
          }
        }
      } catch (error) {
        failure = { error };
        this.controller.abort();
      }
      await this.inFlight;
      if (failure) {
        throw failure.error;
      }
      this.rethrowFatal();

      if (
        !(signal?.aborted ?? false) &&
        this.transcript.size > 0 &&
        this.clock() >= this.backoffUntil
      ) {
        await this.runTurn();
        this.rethrowFatal();
      }
      const aborted = signal?.aborted ?? false;
      const final = this.executor.snapshot();
      await this.emit({
        ...this.base(null),
        type: "end",
        reason: aborted ? "aborted" : "stream ended",
        ...final,
      });
      return final;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  // Assigned from other methods, which narrowing cannot see through.
  private rethrowFatal(): void {
    const fatal: { error: unknown } | undefined = this.fatal;
    if (fatal) {
      throw fatal.error;
    }
  }

  private handle(event: EngineEvent): void {
    switch (event.kind) {
      case "tick": {
        this.executor.update(event.tick);
        break;
      }
      case "segment": {
        this.transcript.add(event.segment);
        break;
      }
      case "heartbeat": {
        break;
      }
    }
  }

  private async maybeSnapshot(): Promise<void> {
    const interval = this.options.snapshotIntervalMs ?? 60_000;
    if (interval <= 0) {
      return;
    }
    const now = this.clock();
    if (now - this.lastSnapshotAt < interval) {
      return;
    }
    this.lastSnapshotAt = now;
    await this.emit({
      ...this.base(null),
      type: "snapshot",
      ...this.executor.snapshot(),
    });
  }

  private async maybeEvaluate(): Promise<void> {
    if (this.inFlight || this.fatal) {
      return;
    }
    const now = this.clock();
    if (now < this.backoffUntil) {
      return;
    }
    const due = shouldEvaluate(this.options.trigger, {
      pendingChars: this.transcript.pendingChars,
      pendingSegments: this.transcript.size,
      msSinceLastEvaluation: now - this.lastEvaluationAt,
      inFlight: false,
    });
    if (!due) {
      return;
    }
    const turn = this.runTurn();
    if (this.options.awaitDecisions ?? false) {
      await turn;
    } else {
      this.inFlight = turn.finally(() => {
        this.inFlight = undefined;
      });
    }
  }

  /** One turn: never rejects; a fatal problem is recorded and ends the run. */
  private async runTurn(): Promise<void> {
    const segments = this.transcript.take();
    const startedAt = this.clock();
    this.lastEvaluationAt = startedAt;
    const turn = ++this.turn;
    const input = this.input(turn, segments, startedAt);
    const marks = this.executor.marks();
    try {
      let result: DecideResult;
      try {
        result = await this.options.decider.decide(
          input,
          this.controller.signal
        );
      } catch (error) {
        if (!(error instanceof DeciderError)) {
          throw error;
        }
        await this.failed(error, segments, turn);
        return;
      }
      this.transientFailures = 0;
      this.repeatedFailures = 0;
      this.transcript.remember(segments);
      // Clamp and dedupe here too, so scripted deciders get the same rules.
      result = { ...result, output: normalizeTurnOutput(result.output) };
      await this.emit({
        ...this.base(turn),
        type: "decision",
        decisions: result.output.decisions,
        ...(result.output.holds ? { holds: result.output.holds } : {}),
        signal: result.output.signal ?? null,
        model: result.model ?? null,
        latencyMs: result.latencyMs,
        segments: segments.length,
        usage: result.usage ?? null,
        market: Object.fromEntries(
          input.prices.map((view) => [view.instrument, view.market ?? null])
        ),
      });
      await this.executor.apply(result, turn, marks);
      this.lastSnapshotAt = this.clock();
      await this.emit({
        ...this.base(turn),
        type: "snapshot",
        ...this.executor.snapshot(),
      });
    } catch (error) {
      this.fatal ??= { error };
      this.controller.abort();
    }
  }

  private async failed(
    error: DeciderError,
    segments: Segment[],
    turn: number
  ): Promise<void> {
    if (error.kind === "aborted") {
      this.transcript.restore(segments);
      return;
    }
    await this.emit({
      ...this.base(turn),
      type: "error",
      kind: error.kind,
      message: error.message,
      retryable: error.retryable,
    });
    if (error.kind === "api") {
      // A bad key, an unknown model, a rejected request: nothing here will
      // change, so the run ends rather than knocking on the door forever.
      this.fatal ??= { error };
      this.controller.abort();
      return;
    }
    if (error.retryable) {
      this.transientFailures += 1;
      const delay = Math.min(
        this.options.trigger.maxWaitMs * 2 ** (this.transientFailures - 1),
        maxBackoffMs
      );
      this.backoffUntil = this.clock() + delay;
      this.transcript.restore(segments);
      this.logger.warn("decider failed, will retry", {
        kind: error.kind,
        delayMs: delay,
        err: error,
      });
      return;
    }
    // The same lines will probably fail again; wait a full interval before
    // trying once more, and give up on them after a few attempts.
    this.repeatedFailures += 1;
    this.backoffUntil = this.clock() + this.options.trigger.maxWaitMs;
    if (this.repeatedFailures >= maxRepeatedFailures) {
      this.repeatedFailures = 0;
      this.logger.warn("decider kept failing, dropping pending transcript", {
        kind: error.kind,
        segments: segments.length,
        err: error,
      });
      return;
    }
    this.transcript.restore(segments);
    this.logger.warn("decider failed", { kind: error.kind, err: error });
  }

  private input(turn: number, segments: Segment[], now: number): TurnInput {
    const context = this.transcript.recent();
    return {
      turn,
      now: new Date(now).toISOString(),
      segments,
      context,
      audioEnd: this.transcript.audioTime,
      prices: this.executor.views(now),
      snapshot: this.executor.snapshot(),
      feedback: this.executor.recentFeedback(),
    };
  }

  private base(turn: number | null): EventBase {
    return {
      run: this.options.run,
      time: new Date(this.clock()).toISOString(),
      audioTime: this.transcript.audioTime ?? null,
      turn,
    };
  }

  /** Hands events to `onEvent` one at a time, in order. */
  private emit(event: JevEvent): Promise<void> {
    const next = this.queue.then(() => this.options.onEvent(event));
    // Keep the chain alive after a failure; the failure itself is awaited.
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export { Engine };
export type { EngineEvent, EngineOptions } from "./engine-options";
