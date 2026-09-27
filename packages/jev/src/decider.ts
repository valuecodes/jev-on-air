// The seam between the engine and whatever decides: the TypeSafe-backed
// decider in `typesafe.ts`, or the scripted ones used by tests and
// token-free dry runs.
import type { TurnInput } from "./questions";
import type { TurnOutput } from "./schema";

export type Usage = {
  inputTokens: number;
  outputTokens: number;
};

export type DecideResult = {
  output: TurnOutput;
  model?: string;
  latencyMs: number;
  usage?: Usage;
};

export type DeciderFailure =
  /** The answer named a choice that was not offered. */
  | "unparseable"
  | "rate_limit"
  | "connection"
  /** A 5xx from the provider. */
  | "server"
  /** Any other API error: bad key, unknown model, invalid request. */
  | "api"
  /** The call was aborted through the signal. */
  | "aborted";

const retryable: ReadonlySet<DeciderFailure> = new Set([
  "rate_limit",
  "connection",
  "server",
]);

export class DeciderError extends Error {
  readonly kind: DeciderFailure;
  /** Whether the same input is worth sending again later. */
  readonly retryable: boolean;

  constructor(kind: DeciderFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DeciderError";
    this.kind = kind;
    this.retryable = retryable.has(kind);
  }
}

export type Decider = {
  /** Decides on `input`. Throws `DeciderError` when no decision was made. */
  decide(input: TurnInput, signal?: AbortSignal): Promise<DecideResult>;
};

const hold: TurnOutput = { decisions: [] };

/** Never trades. Exercises the plumbing without spending tokens. */
export class HoldDecider implements Decider {
  decide(): Promise<DecideResult> {
    return Promise.resolve({ output: hold, latencyMs: 0 });
  }
}

/** Returns the scripted outputs in order, then holds. Records its inputs. */
export class ScriptedDecider implements Decider {
  readonly inputs: TurnInput[] = [];
  private readonly outputs: TurnOutput[];

  constructor(outputs: readonly TurnOutput[]) {
    this.outputs = [...outputs];
  }

  decide(input: TurnInput): Promise<DecideResult> {
    this.inputs.push(input);
    return Promise.resolve({
      output: this.outputs.shift() ?? hold,
      latencyMs: 0,
    });
  }
}
