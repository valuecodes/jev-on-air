// Why the engine turns down a decision before it reaches the book, checked in
// order: a position closed under it, no market-moving signal, low confidence,
// a stale price, or a move already made.
import type { Exit } from "./questions";
import type { Action } from "./schema";

type GateInput = {
  action: Action;
  confidence: number;
  /** The exit the engine made on the instrument while deciding, if any. */
  closedBy: Exit | undefined;
  signal: number | undefined;
  minSignal: number;
  minConfidence: number;
  ageMs: number | undefined;
  maxAgeMs: number;
  /** The 5-minute move in usual moves, when known. */
  moveZ: number | undefined;
  /** 0 disables the check. */
  maxChaseZ: number;
};

const opensPosition = (action: Action): boolean =>
  action === "buy" || action === "short";

/** The reason to reject the decision, or `undefined` to let it through. */
const rejectReason = (input: GateInput): string | undefined => {
  const { action, confidence, closedBy, signal, minSignal } = input;
  const { minConfidence, ageMs, maxAgeMs, moveZ, maxChaseZ } = input;
  const opens = opensPosition(action);
  if (closedBy !== undefined) {
    return `position was closed by a ${closedBy} while deciding`;
  }
  if (opens && signal !== undefined && signal < minSignal) {
    return `no market-moving statement (signal ${signal.toFixed(2)} below ${minSignal.toFixed(2)})`;
  }
  if (confidence < minConfidence) {
    return `confidence ${confidence.toFixed(2)} below ${minConfidence.toFixed(2)}`;
  }
  if (ageMs !== undefined && ageMs > maxAgeMs) {
    return `stale price (${Math.round(ageMs / 1000)} s old)`;
  }
  if (
    opens &&
    maxChaseZ > 0 &&
    moveZ !== undefined &&
    (action === "buy" ? moveZ > maxChaseZ : moveZ < -maxChaseZ)
  ) {
    return `already moved ${Math.abs(moveZ).toFixed(1)} usual moves ${moveZ > 0 ? "up" : "down"}; likely priced in`;
  }
  return undefined;
};

export { opensPosition, rejectReason };
