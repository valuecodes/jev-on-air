// When to ask the model: once enough new transcript has piled up, or once the
// oldest unsent line has waited long enough, and never while a call is out.

type TriggerOptions = {
  /** Pending transcript characters that trigger a turn on their own. */
  minChars: number;
  /** Longest a non-empty buffer waits before a turn, in milliseconds. */
  maxWaitMs: number;
};

type TriggerState = {
  pendingChars: number;
  pendingSegments: number;
  msSinceLastEvaluation: number;
  inFlight: boolean;
};

const shouldEvaluate = (
  options: TriggerOptions,
  state: TriggerState
): boolean =>
  state.pendingSegments > 0 &&
  !state.inFlight &&
  (state.pendingChars >= options.minChars ||
    state.msSinceLastEvaluation >= options.maxWaitMs);

export { shouldEvaluate };
export type { TriggerOptions, TriggerState };
