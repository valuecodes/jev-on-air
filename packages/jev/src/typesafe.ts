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
import type { ChoiceResponse, NoulResponse, Usage } from "@typesafe-ai/sdk";

import { DeciderError } from "./decider";
import type { Decider, DecideResult } from "./decider";
import { buildQuestions, buildState, SIGNAL_QUESTION } from "./questions";
import type { TurnInput } from "./questions";
import { CHOICES, normalizeTurnOutput } from "./schema";
import type { Action, Choice, Decision } from "./schema";

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
): Pick<Decision, "action" | "confidence" | "probabilities"> | undefined {
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
  if (picked === "hold") return undefined;
  const odds: NonNullable<Decision["probabilities"]> = {};
  if (isRecord(probabilities))
    for (const option of CHOICES) {
      const probability = probabilities[option];
      if (typeof probability === "number" && Number.isFinite(probability))
        odds[option] = Number(probability.toFixed(3));
    }
  return {
    action: picked as Choice as Action,
    confidence,
    probabilities: odds,
  };
}

/** Turns the answers into a result, or throws the matching `DeciderError`. */
export function interpretAnswers(
  answers: TurnAnswers | undefined,
  instruments: readonly InstrumentId[],
  meta: { model: string; usage: Usage | undefined; latencyMs: number }
): DecideResult {
  if (!isRecord(answers))
    throw new DeciderError("unparseable", "reply carried no answers");
  const gate: unknown = answers[SIGNAL_QUESTION];
  const noul = isRecord(gate) ? gate.noul : undefined;
  const signal =
    typeof noul === "number" && Number.isFinite(noul) ? noul : undefined;
  const decisions: Decision[] = [];
  for (const instrument of instruments) {
    const picked = readChoice(instrument, answers[instrument]);
    if (picked) decisions.push({ instrument, ...picked });
  }
  const usage = meta.usage;
  return {
    output: normalizeTurnOutput({
      decisions,
      ...(signal === undefined ? {} : { signal }),
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

  constructor(logger: LoggerLike, options: TypeSafeDeciderOptions = {}) {
    this.logger = logger.child({ component: "typesafe" });
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
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

  async decide(input: TurnInput, signal?: AbortSignal): Promise<DecideResult> {
    const startedAt = Date.now();
    const instruments = input.prices.map((view) => view.instrument);
    let response;
    try {
      response = await this.client.systemOne(
        {
          state: buildState(input),
          questions: buildQuestions(input),
          model: this.model,
        },
        { signal, timeout: this.timeoutMs }
      );
    } catch (error) {
      throw toDeciderError(error);
    }
    const result = interpretAnswers(response.answers, instruments, {
      model: String(response.model),
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
    });
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
}
