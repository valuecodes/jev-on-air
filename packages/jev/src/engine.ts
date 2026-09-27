// The loop: consumes merged transcript, price and heartbeat events, asks the
// decider when the trigger says so, applies its decisions to the portfolio
// at the prices current when the answer arrives, and reports every step as
// ledger events. No I/O of its own: persistence is the `onEvent` hook's job.
import { INSTRUMENTS } from "@repo/alpaca/instruments";
import type { PriceTick } from "@repo/alpaca/prices";
import type { LoggerLike } from "@repo/logger";
import type { Segment } from "@repo/transcriber";

import { DeciderError } from "./decider";
import type { Decider, DecideResult } from "./decider";
import type { EventBase, JevEvent } from "./ledger";
import type { Source } from "./merge";
import type { Portfolio, Snapshot } from "./portfolio";
import { PriceTable } from "./prices";
import type { Feedback, PriceView, TurnInput } from "./questions";
import { normalizeTurnOutput } from "./schema";
import { shouldEvaluate } from "./trigger";
import type { TriggerOptions } from "./trigger";

export type EngineEvent =
  | { kind: "segment"; segment: Segment }
  | { kind: "tick"; tick: PriceTick }
  | { kind: "heartbeat" };

export type EngineOptions = {
  events: Source<EngineEvent>;
  decider: Decider;
  portfolio: Portfolio;
  trigger: TriggerOptions;
  /** Decisions below this confidence are rejected (default 0.6). */
  minConfidence?: number;
  /**
   * Entries are rejected when the decider's signal (its probability that the
   * new lines held a market-moving statement) is below this (default 0.5).
   * Exits are never gated.
   */
  minSignal?: number;
  /** Most pending transcript kept; older lines are dropped (default 4000). */
  maxBufferChars?: number;
  /** Most pending lines kept, whatever their length (default 100). */
  maxBufferSegments?: number;
  /**
   * Seconds of audio the model is reminded of after a turn, so it can tell a
   * new statement from a repeat (default 300).
   */
  contextSeconds?: number;
  /** Most characters of that reminder (default 6000). */
  maxContextChars?: number;
  /** Fills and rejections of recent turns shown to the model (default 12). */
  maxFeedback?: number;
  /** Fills on a price that arrived longer ago are rejected (default 10 min). */
  maxPriceAgeMs?: number;
  /** Snapshot cadence between turns; 0 disables (default 60 s). */
  snapshotIntervalMs?: number;
  /**
   * Await each model call inline. Off, the loop keeps consuming events during
   * a call and fills use the prices current when it returns; on, runs are
   * deterministic (fast replay, tests).
   */
  awaitDecisions?: boolean;
  /** Milliseconds since the epoch; virtual in fast replay (default Date.now). */
  clock?: () => number;
  /** Receives every ledger event, in order; a rejection ends the run. */
  onEvent: (event: JevEvent) => Promise<void> | void;
  /** Id of the run, stamped on every event. */
  run: string;
  /** Reported in the start event. */
  source: string;
  model: string;
  size: number;
  resumed: boolean;
};

// After this many non-retryable failures in a row the pending lines go.
const maxRepeatedFailures = 3;
const maxBackoffMs = 300_000;

export class Engine {
  private readonly logger: LoggerLike;
  private readonly options: EngineOptions;
  private readonly clock: () => number;
  private readonly prices = new PriceTable();
  private readonly pending: Segment[] = [];
  private pendingChars = 0;
  private readonly context: Segment[] = [];
  private feedback: Feedback[] = [];
  private turn = 0;
  private lastAudioTime: number | undefined;
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
    if (signal?.aborted) this.controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    const now = this.clock();
    this.lastEvaluationAt = now;
    this.lastSnapshotAt = now;
    const start = this.snapshot();
    await this.emit({
      ...this.base(null),
      type: "start",
      source: this.options.source,
      model: this.options.model,
      cash: start.cash,
      equity: start.equity,
      size: this.options.size,
      resumed: this.options.resumed,
    });

    // The abort listener stays until the run has settled: a call in flight
    // or the final flush must still be cancellable once the source has ended.
    try {
      let failure: { error: unknown } | undefined;
      try {
        for await (const event of this.options.events(this.controller.signal)) {
          this.handle(event);
          await this.maybeSnapshot();
          await this.maybeEvaluate();
          if (this.fatal) break;
        }
      } catch (error) {
        failure = { error };
        this.controller.abort();
      }
      await this.inFlight;
      if (failure) throw failure.error;
      this.rethrowFatal();

      if (
        !(signal?.aborted ?? false) &&
        this.pending.length > 0 &&
        this.clock() >= this.backoffUntil
      ) {
        await this.runTurn();
        this.rethrowFatal();
      }
      const aborted = signal?.aborted ?? false;
      const final = this.snapshot();
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
    if (fatal) throw fatal.error;
  }

  private handle(event: EngineEvent): void {
    switch (event.kind) {
      case "tick":
        this.prices.update(event.tick, this.clock());
        return;
      case "segment":
        this.pending.push(event.segment);
        this.pendingChars += event.segment.text.length;
        this.lastAudioTime = event.segment.end;
        this.trim();
        return;
      case "heartbeat":
        return;
    }
  }

  private trim(): void {
    const max = this.options.maxBufferChars ?? 4000;
    const maxSegments = this.options.maxBufferSegments ?? 100;
    let dropped = 0;
    while (
      (this.pendingChars > max || this.pending.length > maxSegments) &&
      this.pending.length > 1
    ) {
      const oldest = this.pending.shift();
      if (!oldest) break;
      this.pendingChars -= oldest.text.length;
      dropped += 1;
    }
    if (dropped > 0)
      this.logger.warn("transcript buffer full, dropped oldest lines", {
        dropped,
        maxChars: max,
        maxSegments,
      });
  }

  /** Moves sent lines into the context window. */
  private remember(segments: Segment[]): void {
    this.context.push(...segments);
    this.forget();
  }

  /** Drops context older than the window, measured from the latest audio. */
  private forget(): void {
    const horizon =
      (this.lastAudioTime ?? 0) - (this.options.contextSeconds ?? 300);
    const maxChars = this.options.maxContextChars ?? 6000;
    let chars = this.context.reduce((sum, item) => sum + item.text.length, 0);
    while (this.context.length > 0) {
      const oldest = this.context[0];
      if (!oldest || (oldest.end > horizon && chars <= maxChars)) break;
      this.context.shift();
      chars -= oldest.text.length;
    }
  }

  private async maybeSnapshot(): Promise<void> {
    const interval = this.options.snapshotIntervalMs ?? 60_000;
    if (interval <= 0) return;
    const now = this.clock();
    if (now - this.lastSnapshotAt < interval) return;
    this.lastSnapshotAt = now;
    await this.emit({
      ...this.base(null),
      type: "snapshot",
      ...this.snapshot(),
    });
  }

  private async maybeEvaluate(): Promise<void> {
    if (this.inFlight || this.fatal) return;
    const now = this.clock();
    if (now < this.backoffUntil) return;
    const due = shouldEvaluate(this.options.trigger, {
      pendingChars: this.pendingChars,
      pendingSegments: this.pending.length,
      msSinceLastEvaluation: now - this.lastEvaluationAt,
      inFlight: false,
    });
    if (!due) return;
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
    const segments = this.pending.splice(0);
    this.pendingChars = 0;
    const startedAt = this.clock();
    this.lastEvaluationAt = startedAt;
    const turn = ++this.turn;
    const input = this.input(turn, segments, startedAt);
    try {
      let result: DecideResult;
      try {
        result = await this.options.decider.decide(
          input,
          this.controller.signal
        );
      } catch (error) {
        if (!(error instanceof DeciderError)) throw error;
        await this.failed(error, segments, turn);
        return;
      }
      this.transientFailures = 0;
      this.repeatedFailures = 0;
      this.remember(segments);
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
      });
      await this.apply(result, turn);
      this.lastSnapshotAt = this.clock();
      await this.emit({
        ...this.base(turn),
        type: "snapshot",
        ...this.snapshot(),
      });
    } catch (error) {
      this.fatal ??= { error };
      this.controller.abort();
    }
  }

  private async apply(result: DecideResult, turn: number): Promise<void> {
    const minConfidence = this.options.minConfidence ?? 0.6;
    const minSignal = this.options.minSignal ?? 0.5;
    const maxAge = this.options.maxPriceAgeMs ?? 600_000;
    const now = this.clock();
    const prices = this.prices.map();
    const signal = result.output.signal;
    const gated = signal !== undefined && signal < minSignal;
    for (const decision of result.output.decisions) {
      const { instrument, action, confidence } = decision;
      const age = this.prices.ageMs(instrument, now);
      const opens = action === "buy" || action === "short";
      const outcome =
        gated && opens
          ? {
              kind: "reject" as const,
              reason: `no market-moving statement (signal ${signal.toFixed(2)} below ${minSignal.toFixed(2)})`,
            }
          : confidence < minConfidence
            ? {
                kind: "reject" as const,
                reason: `confidence ${confidence.toFixed(2)} below ${minConfidence.toFixed(2)}`,
              }
            : age !== undefined && age > maxAge
              ? {
                  kind: "reject" as const,
                  reason: `stale price (${Math.round(age / 1000)} s old)`,
                }
              : this.options.portfolio.apply({ instrument, action }, prices);
      this.feedback.push({ turn, instrument, action, result: outcome });
      await this.emit(
        outcome.kind === "fill"
          ? { ...this.base(turn), type: "fill", confidence, ...outcome.fill }
          : {
              ...this.base(turn),
              type: "reject",
              instrument,
              action,
              confidence,
              reason: outcome.reason,
            }
      );
    }
    const keep = this.options.maxFeedback ?? 12;
    if (this.feedback.length > keep)
      this.feedback.splice(0, this.feedback.length - keep);
  }

  private async failed(
    error: DeciderError,
    segments: Segment[],
    turn: number
  ): Promise<void> {
    if (error.kind === "aborted") {
      this.restore(segments);
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
      this.restore(segments);
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
    this.restore(segments);
    this.logger.warn("decider failed", { kind: error.kind, err: error });
  }

  /** Puts unsent lines back at the front of the buffer. */
  private restore(segments: Segment[]): void {
    this.pending.unshift(...segments);
    this.pendingChars = this.pending.reduce(
      (sum, segment) => sum + segment.text.length,
      0
    );
    this.trim();
  }

  private input(turn: number, segments: Segment[], now: number): TurnInput {
    this.forget();
    const prices: PriceView[] = INSTRUMENTS.map((instrument) => {
      const latest = this.prices.get(instrument.id);
      const age = this.prices.ageMs(instrument.id, now);
      return {
        instrument: instrument.id,
        name: instrument.name,
        symbol: instrument.symbol,
        price: latest?.price,
        ageSeconds: age === undefined ? undefined : age / 1000,
      };
    });
    return {
      turn,
      now: new Date(now).toISOString(),
      segments,
      context: [...this.context],
      audioEnd: this.lastAudioTime,
      prices,
      snapshot: this.snapshot(),
      feedback: [...this.feedback],
    };
  }

  private snapshot(): Snapshot {
    return this.options.portfolio.markToMarket(this.prices.map());
  }

  private base(turn: number | null): EventBase {
    return {
      run: this.options.run,
      time: new Date(this.clock()).toISOString(),
      audioTime: this.lastAudioTime ?? null,
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
