// The decider backed by TypeSafe AI's Jev: one call per turn with the state
// and questions from `questions.ts`. The only file that talks to the
// provider; everything it returns or throws is mapped onto `DecideResult`
// and `DeciderError` so the engine stays generic.
import type { InstrumentId } from "@repo/alpaca/instruments";
import type { LoggerLike } from "@repo/logger";
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import type {
  ChoiceQuestion,
  ChoiceResponse,
  JsonValue,
  NoulQuestion,
  NoulResponse,
  Usage,
} from "@typesafe-ai/sdk";

import { DeciderError } from "./decider";
import type { Decider, DecideResult } from "./decider";
import {
  buildInstrumentQuestions,
  buildSignalQuestion,
  buildState,
  SIGNAL_QUESTION,
} from "./questions";
import type { TurnInput } from "./questions";
import { CHOICES, normalizeTurnOutput } from "./schema";
import type { Choice, Decision, Hold } from "./schema";

/** The alias TypeSafe keeps on its newest stable release. */
export const DEFAULT_MODEL = "jev-latest";

export type TypeSafeDeciderOptions = {
  /** A configured client; otherwise one is made from `apiKey`. */
  client?: TypeSafeClient;
  apiKey?: string;
  /** Model id (default `jev-latest`). */
  model?: string;
  /** Per-attempt timeout in milliseconds (default 30 000). */
  timeoutMs?: number;
  /**
   * The engine's `minSignal`: below it every entry is rejected, so with a
   * flat book the instrument questions are skipped (default 0: always ask).
   */
  skipBelowSignal?: number;
};

/** The answers a turn needs: the instrument choices and the signal gate. */
export type TurnAnswers = Partial<Record<InstrumentId, ChoiceResponse>> & {
  [SIGNAL_QUESTION]?: NoulResponse;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Reads one instrument's answer without trusting its shape: the SDK hands
 * the server's JSON through unchecked, and an odd reply should cost a turn,
 * not the run.
 */
function readChoice(
  instrument: InstrumentId,
  answer: unknown
): { choice: Choice } & Pick<Decision, "confidence" | "probabilities"> {
  if (!isRecord(answer))
    throw new DeciderError("unparseable", `no answer for ${instrument}`);
  const { choice: picked, confidence, probabilities } = answer;
  if (
    typeof picked !== "string" ||
    !(CHOICES as readonly string[]).includes(picked)
  )
    throw new DeciderError(
      "unparseable",
      `unknown choice ${String(picked)} for ${instrument}`
    );
  if (typeof confidence !== "number" || !Number.isFinite(confidence))
    throw new DeciderError("unparseable", `no confidence for ${instrument}`);
  const odds: NonNullable<Decision["probabilities"]> = {};
  if (isRecord(probabilities))
    for (const option of CHOICES) {
      const probability = probabilities[option];
      if (typeof probability === "number" && Number.isFinite(probability))
        odds[option] = Number(probability.toFixed(3));
    }
  return { choice: picked as Choice, confidence, probabilities: odds };
}

/** The signal answer, if one came back. Throws on a malformed one. */
function readSignal(answers: Record<string, unknown>): number | undefined {
  // The gate is optional, but a present answer must be a probability: a
  // malformed one would otherwise silently switch the gate off.
  const gate: unknown = answers[SIGNAL_QUESTION];
  if (gate === undefined) return undefined;
  const noul = isRecord(gate) ? gate.noul : undefined;
  if (typeof noul !== "number" || !Number.isFinite(noul))
    throw new DeciderError("unparseable", "invalid signal answer");
  return noul;
}

/** Turns the answers into a result, or throws the matching `DeciderError`. */
export function interpretAnswers(
  answers: TurnAnswers | undefined,
  instruments: readonly InstrumentId[],
  meta: { model: string; usage: Usage | undefined; latencyMs: number }
): DecideResult {
  if (!isRecord(answers))
    throw new DeciderError("unparseable", "reply carried no answers");
  const signal = readSignal(answers);
  const decisions: Decision[] = [];
  const holds: Hold[] = [];
  for (const instrument of instruments) {
    const { choice: picked, ...odds } = readChoice(
      instrument,
      answers[instrument]
    );
    if (picked === "hold") holds.push({ instrument, ...odds });
    else decisions.push({ instrument, action: picked, ...odds });
  }
  const usage = meta.usage;
  return {
    output: normalizeTurnOutput({
      decisions,
      ...(signal === undefined ? {} : { signal }),
      holds,
    }),
    model: meta.model,
    latencyMs: meta.latencyMs,
    ...(isRecord(usage)
      ? {
          usage: {
            inputTokens: Number(usage.input_tokens) || 0,
            outputTokens: Number(usage.output_tokens) || 0,
          },
        }
      : {}),
  };
}

/** Maps an SDK error onto a `DeciderError`; anything else passes through. */
export function toDeciderError(error: unknown): unknown {
  if (error instanceof DeciderError) return error;
  if (error instanceof APIUserAbortError)
    return new DeciderError("aborted", "call aborted", { cause: error });
  if (error instanceof APIConnectionError)
    return new DeciderError("connection", error.message, { cause: error });
  if (error instanceof RateLimitError)
    return new DeciderError("rate_limit", error.message, { cause: error });
  if (error instanceof InternalServerError)
    return new DeciderError("server", error.message, { cause: error });
  if (error instanceof APIError || error instanceof TypeSafeError)
    return new DeciderError("api", error.message, { cause: error });
  return error;
}

export class TypeSafeDecider implements Decider {
  private readonly logger: LoggerLike;
  private readonly client: TypeSafeClient;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly skipBelowSignal: number;

  constructor(logger: LoggerLike, options: TypeSafeDeciderOptions = {}) {
    this.logger = logger.child({ component: "typesafe" });
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.skipBelowSignal = options.skipBelowSignal ?? 0;
    // The engine owns retries and backoff, so the SDK's are off; its logger
    // would print request bodies at debug, so ours logs the summary instead.
    this.client =
      options.client ??
      new TypeSafeClient({
        apiKey: options.apiKey,
        logLevel: "off",
        retry: { maxRetries: 0 },
      });
  }

  /**
   * Two calls: the signal question first, then the instrument questions
   * with that read in the state, so each choice knows whether the desk
   * judged the lines market-moving. A low read on a flat book ends the turn
   * after the first call, since every entry would be rejected.
   */
  async decide(input: TurnInput, signal?: AbortSignal): Promise<DecideResult> {
    const startedAt = Date.now();
    const instruments = input.prices.map((view) => view.instrument);
    const gate = await this.ask(
      // The gate reads the speech alone; price action is for the choices.
      buildState(input, undefined, { market: false }),
      buildSignalQuestion(),
      signal
    );
    if (!isRecord(gate.answers))
      throw new DeciderError("unparseable", "reply carried no answers");
    // Clamped like the engine will clamp it, before it is compared or shown.
    const raw = readSignal(gate.answers);
    const read = raw === undefined ? undefined : Math.min(1, Math.max(0, raw));
    const flat = input.snapshot.positions.length === 0;
    let result: DecideResult;
    if (
      instruments.length === 0 ||
      (read !== undefined && read < this.skipBelowSignal && flat)
    ) {
      result = interpretAnswers(gate.answers, [], {
        model: String(gate.model),
        usage: gate.usage,
        latencyMs: Date.now() - startedAt,
      });
    } else {
      const choices = await this.ask(
        buildState(input, read),
        buildInstrumentQuestions(input),
        signal
      );
      const answers = isRecord(choices.answers) ? choices.answers : undefined;
      result = interpretAnswers(
        answers && { ...answers, [SIGNAL_QUESTION]: gate.answers.signal },
        instruments,
        {
          model: String(choices.model),
          usage: addUsage(gate.usage, choices.usage),
          latencyMs: Date.now() - startedAt,
        }
      );
    }
    this.logger.debug("turn decided", {
      turn: input.turn,
      model: result.model,
      latencyMs: result.latencyMs,
      ...result.usage,
      signal: result.output.signal,
      decisions: result.output.decisions.length,
    });
    return result;
  }

  private async ask(
    state: Record<string, JsonValue>,
    questions: Record<string, ChoiceQuestion | NoulQuestion>,
    signal: AbortSignal | undefined
  ): Promise<{
    answers: TurnAnswers | undefined;
    model: unknown;
    usage: Usage | undefined;
  }> {
    try {
      const response = await this.client.systemOne(
        { state, questions, model: this.model },
        { signal, timeout: this.timeoutMs }
      );
      return {
        answers: response.answers,
        model: response.model,
        usage: response.usage,
      };
    } catch (error) {
      throw toDeciderError(error);
    }
  }
}

/** Both calls' token counts, when either reported any. */
function addUsage(
  a: Usage | undefined,
  b: Usage | undefined
): Usage | undefined {
  if (!isRecord(a)) return b;
  if (!isRecord(b)) return a;
  return {
    ...b,
    input_tokens: (Number(a.input_tokens) || 0) + (Number(b.input_tokens) || 0),
    output_tokens:
      (Number(a.output_tokens) || 0) + (Number(b.output_tokens) || 0),
  };
}
