// What a run writes down: every decision, fill, rejection, snapshot and error,
// as JSON lines for later analysis and as one-line text for the terminal.
import type { InstrumentId } from "@repo/alpaca/instruments";

import type { DeciderFailure, Usage } from "./decider";
import type { Fill, Snapshot } from "./portfolio";
import type { Action, Decision } from "./schema";

export type EventBase = {
  /** Id of the run (its ISO start time), so appended runs can be told apart. */
  run: string;
  /** ISO time from the engine clock: wall clock live, virtual in fast replay. */
  time: string;
  /** Audio time (seconds) of the last transcript line consumed, if any. */
  audioTime: number | null;
  /** The turn the event belongs to, if any. */
  turn: number | null;
};

export type StartEvent = EventBase & {
  type: "start";
  source: string;
  model: string;
  cash: number;
  equity: number;
  size: number;
  resumed: boolean;
};

export type DecisionEvent = EventBase & {
  type: "decision";
  decisions: Decision[];
  /** Probability that the new lines held a market-moving statement. */
  signal: number | null;
  model: string | null;
  latencyMs: number;
  segments: number;
  usage: Usage | null;
};

export type FillEvent = EventBase & { type: "fill"; confidence: number } & Fill;

export type RejectEvent = EventBase & {
  type: "reject";
  instrument: InstrumentId;
  action: Action;
  confidence: number;
  reason: string;
};

export type SnapshotEvent = EventBase & { type: "snapshot" } & Snapshot;

export type ErrorEvent = EventBase & {
  type: "error";
  kind: DeciderFailure;
  message: string;
  retryable: boolean;
};

export type EndEvent = EventBase & {
  type: "end";
  reason: "stream ended" | "aborted";
} & Snapshot;

export type JevEvent =
  | StartEvent
  | DecisionEvent
  | FillEvent
  | RejectEvent
  | SnapshotEvent
  | ErrorEvent
  | EndEvent;

const money = (value: number): string => value.toFixed(2);
const signed = (value: number): string =>
  `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;

function book(snapshot: Snapshot): string {
  const positions = snapshot.positions.map(
    (position) =>
      `${position.instrument} ${position.side === "long" ? "L" : "S"} ${position.quantity.toFixed(4)}@${money(position.avgPrice)} (${signed(position.unrealizedPnl)})`
  );
  return [
    `equity ${money(snapshot.equity)}`,
    `cash ${money(snapshot.cash)}`,
    `realized ${signed(snapshot.realized)}`,
    ...positions,
  ].join("  ");
}

function decision(item: Decision): string {
  const odds = item.probabilities
    ? ` (${Object.entries(item.probabilities)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([option, probability]) => `${option} ${probability.toFixed(2)}`)
        .join(", ")})`
    : "";
  return `${item.action} ${item.instrument} ${item.confidence.toFixed(2)}${odds}`;
}

/** One line per event: `hh:mm:ss  type      details`. */
export function formatEvent(event: JevEvent): string {
  const clock = event.time.slice(11, 19);
  const turn = event.turn === null ? "" : `#${event.turn} `;
  let detail: string;
  switch (event.type) {
    case "start":
      detail = `${event.source}  model ${event.model}  cash ${money(event.cash)}  equity ${money(event.equity)}  size ${event.size}${event.resumed ? "  (resumed)" : ""}`;
      break;
    case "decision": {
      const signal =
        event.signal === null ? "" : `  signal ${event.signal.toFixed(2)}`;
      detail =
        event.decisions.length === 0
          ? `hold${signal}`
          : `${event.decisions.map(decision).join("; ")}${signal}`;
      break;
    }
    case "fill":
      detail = `${event.action} ${event.instrument} ${event.quantity.toFixed(4)} @ ${money(event.price)}  ${money(event.notional)}${event.realizedPnl === 0 ? "" : `  realized ${signed(event.realizedPnl)}`}  cash ${money(event.cash)}`;
      break;
    case "reject":
      detail = `${event.action} ${event.instrument} — ${event.reason}`;
      break;
    case "snapshot":
      detail = book(event);
      break;
    case "error":
      detail = `${event.kind}${event.retryable ? " (will retry)" : ""} — ${event.message}`;
      break;
    case "end":
      detail = `${event.reason}  ${book(event)}`;
      break;
  }
  // Provider and transcript text reach the terminal here; no escape sequences.
  return `${clock}  ${event.type.padEnd(8)}  ${turn}${detail}`.replace(
    /\p{Cc}/gu,
    ""
  );
}
