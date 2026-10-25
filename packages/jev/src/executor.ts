// The engine's side of the book: prices and market features as ticks arrive,
// a turn's decisions through the gates into the portfolio, the engine's own
// stops and take-profits, and the recent results the model is shown.
import { INSTRUMENTS } from "@repo/alpaca/instruments";
import type { InstrumentId } from "@repo/alpaca/instruments";
import type { PriceTick } from "@repo/alpaca/prices";

import type { DecideResult } from "./decider";
import type { EngineOptions } from "./engine-options";
import { exitFor, ExitBook } from "./exits";
import { opensPosition, rejectReason } from "./gates";
import type { EventBase, JevEvent } from "./ledger";
import { MarketTape } from "./market";
import type { ApplyResult, Snapshot } from "./portfolio";
import { PriceTable } from "./prices";
import type { Feedback, PriceView } from "./questions";

type ExecutorHooks = {
  clock: () => number;
  /** The common fields of an event for `turn`. */
  base: (turn: number | null) => EventBase;
  emit: (event: JevEvent) => Promise<void>;
  /** Called with the engine clock just before a snapshot goes out. */
  snapshotAt: (at: number) => void;
};

class Executor {
  private readonly options: EngineOptions;
  private readonly hooks: ExecutorHooks;
  private readonly prices = new PriceTable();
  private readonly tape = new MarketTape();
  private readonly exits = new ExitBook();
  private readonly feedback: Feedback[] = [];

  constructor(options: EngineOptions, hooks: ExecutorHooks) {
    this.options = options;
    this.hooks = hooks;
    this.tape.seed(options.marketHistory ?? []);
  }

  update(tick: PriceTick): void {
    this.prices.update(tick, this.hooks.clock());
    this.tape.update(tick, this.hooks.clock());
  }

  /** The book marked at the latest prices. */
  snapshot(): Snapshot {
    return this.options.portfolio.markToMarket(this.prices.map());
  }

  /** The engine's exit counts now, for `apply` to compare against. */
  marks(): ReadonlyMap<InstrumentId, number> {
    return this.exits.marks();
  }

  /** Fills and rejections of recent turns, oldest first. */
  recentFeedback(): Feedback[] {
    return [...this.feedback];
  }

  maxChaseZ(): number {
    return this.options.maxChaseZ ?? 3;
  }

  /** Every instrument's price, its age and how its market is moving. */
  views(now: number): PriceView[] {
    return INSTRUMENTS.map((instrument) => {
      const latest = this.prices.get(instrument.id);
      const age = this.prices.ageMs(instrument.id, now);
      return {
        instrument: instrument.id,
        name: instrument.name,
        symbol: instrument.symbol,
        price: latest?.price,
        ageSeconds: age === undefined ? undefined : age / 1000,
        market: this.tape.features(instrument.id, now),
      };
    });
  }

  /**
   * Applies a turn's decisions. `marks` is the engine's exit count per
   * instrument when the turn's input was built: a decision about a position
   * the engine has closed since was made on a book that no longer exists.
   */
  async apply(
    result: DecideResult,
    turn: number,
    marks: ReadonlyMap<InstrumentId, number>
  ): Promise<void> {
    const now = this.hooks.clock();
    const prices = this.prices.map();
    for (const decision of result.output.decisions) {
      const { instrument, action, confidence } = decision;
      const features = this.tape.features(instrument, now);
      const volatility = features?.volatility;
      const reason = rejectReason({
        action,
        confidence,
        closedBy: this.exits.closedSince(instrument, marks),
        signal: result.output.signal,
        minSignal: this.options.minSignal ?? 0.5,
        minConfidence: this.options.minConfidence ?? 0.6,
        ageMs: this.prices.ageMs(instrument, now),
        maxAgeMs: this.options.maxPriceAgeMs ?? 600_000,
        moveZ: features?.moveZ5m,
        maxChaseZ: this.maxChaseZ(),
      });
      const outcome: ApplyResult =
        reason === undefined
          ? this.options.portfolio.apply(
              { instrument, action },
              prices,
              volatility
            )
          : { kind: "reject", reason };
      this.feedback.push({ turn, instrument, action, result: outcome });
      if (outcome.kind === "fill") {
        this.track(instrument, volatility);
      }
      await this.hooks.emit(
        outcome.kind === "fill"
          ? {
              ...this.hooks.base(turn),
              type: "fill",
              confidence,
              ...(opensPosition(action) && volatility !== undefined
                ? { volatility }
                : {}),
              ...outcome.fill,
            }
          : {
              ...this.hooks.base(turn),
              type: "reject",
              instrument,
              action,
              confidence,
              reason: outcome.reason,
            }
      );
    }
    this.trimFeedback();
  }

  /**
   * Closes the instrument's position when its move from the average price
   * crosses the stop or the take-profit, measured in usual 15-minute moves
   * at entry. Runs on each of its ticks, between and during turns.
   */
  async maybeExit(instrument: InstrumentId, turn: number): Promise<void> {
    const stopZ = this.options.stopZ ?? 0;
    const takeProfitZ = this.options.takeProfitZ ?? 0;
    if (stopZ <= 0 && takeProfitZ <= 0) {
      return;
    }
    if (!this.options.portfolio.position(instrument)) {
      return;
    }
    const now = this.hooks.clock();
    this.track(instrument, this.tape.features(instrument, now)?.volatility);
    const position = this.options.portfolio.position(instrument);
    const volatility = this.exits.entry(instrument);
    const price = this.prices.get(instrument)?.price;
    if (!position || volatility === undefined || price === undefined) {
      return;
    }
    const crossed = exitFor(position, price, volatility, {
      stopZ,
      takeProfitZ,
    });
    if (crossed === undefined) {
      return;
    }
    const { exit, threshold } = crossed;
    const outcome = this.options.portfolio.apply(
      { instrument, action: "close" },
      this.prices.map()
    );
    if (outcome.kind !== "fill") {
      return;
    }
    this.exits.record(instrument, exit);
    this.feedback.push({
      turn,
      instrument,
      action: "close",
      result: outcome,
      exit,
    });
    this.trimFeedback();
    await this.hooks.emit({
      ...this.hooks.base(null),
      type: "fill",
      confidence: null,
      exit,
      exitThresholdPct: threshold,
      ...outcome.fill,
    });
    this.hooks.snapshotAt(now);
    await this.hooks.emit({
      ...this.hooks.base(null),
      type: "snapshot",
      ...this.snapshot(),
    });
  }

  private track(
    instrument: InstrumentId,
    volatility: number | undefined
  ): void {
    const open = this.options.portfolio.position(instrument) !== undefined;
    this.exits.track(instrument, open, volatility);
  }

  private trimFeedback(): void {
    const keep = this.options.maxFeedback ?? 12;
    if (this.feedback.length > keep) {
      this.feedback.splice(0, this.feedback.length - keep);
    }
  }
}

export { Executor };
