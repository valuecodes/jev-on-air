// When to ask the model: once enough new transcript has piled up, or once the
// oldest unsent line has waited long enough, and never while a call is out.

export type TriggerOptions = {
  /** Pending transcript characters that trigger a turn on their own. */
  minChars: number;
  /** Longest a non-empty buffer waits before a turn, in milliseconds. */
  maxWaitMs: number;
};

export type TriggerState = {
  pendingChars: number;
  pendingSegments: number;
  msSinceLastEvaluation: number;
  inFlight: boolean;
};

export function shouldEvaluate(
  options: TriggerOptions,
  state: TriggerState
): boolean {
  return (
    state.pendingSegments > 0 &&
    !state.inFlight &&
    (state.pendingChars >= options.minChars ||
      state.msSinceLastEvaluation >= options.maxWaitMs)
  );
}
