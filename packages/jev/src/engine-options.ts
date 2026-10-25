// What the engine consumes and how it is configured.
import type { PriceTick } from "@repo/alpaca/prices";
import type { Segment } from "@repo/transcriber";

import type { Decider } from "./decider";
import type { JevEvent } from "./ledger";
import type { Source } from "./merge";
import type { Portfolio } from "./portfolio";
import type { TriggerOptions } from "./trigger";

type EngineEvent =
  | { kind: "segment"; segment: Segment }
  | { kind: "tick"; tick: PriceTick }
  | { kind: "heartbeat" };

type EngineOptions = {
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
  /**
   * Ticks from before the run, so market features are ready from the first
   * turn. They count at their exchange time, so the clock must run on it (a
   * replay with a known start); they set no prices, so fills never use them.
   */
  marketHistory?: readonly PriceTick[];
  /**
   * Entries are rejected when the instrument already moved more than this
   * many usual 5-minute moves their way; 0 disables (default 3).
   */
  maxChaseZ?: number;
  /**
   * A position is closed once it has lost this many usual 15-minute moves
   * (volatility at entry × √15) from its average price; 0 disables (default 0).
   */
  stopZ?: number;
  /** ...or gained this many; 0 disables (default 0). */
  takeProfitZ?: number;
  /** How the portfolio sizes fills, reported in the start event. */
  sizing?: string;
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

export type { EngineEvent, EngineOptions };
