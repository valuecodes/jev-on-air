// What Jev may decide: the four instruments, the four actions and the shape
// of a turn's decisions. The zod schemas validate scripted decision files.
import type { InstrumentId } from "@repo/alpaca/instruments";
import { z } from "zod";

export const INSTRUMENT_IDS = [
  "gold",
  "bitcoin",
  "sp500",
  "oil",
] as const satisfies readonly InstrumentId[];

export const ACTIONS = ["buy", "sell", "short", "close"] as const;

/** What the model picks from: an action, or nothing. */
export const CHOICES = ["hold", ...ACTIONS] as const;

export const ActionSchema = z.enum(ACTIONS);

export const DecisionSchema = z.object({
  instrument: z.enum(INSTRUMENT_IDS),
  action: ActionSchema,
  /** 0 to 1: how concentrated the model's probabilities were on this action. */
  confidence: z.number(),
  /** The model's probability for each choice it was offered, when known. */
  probabilities: z.partialRecord(z.enum(CHOICES), z.number()).optional(),
});

export const TurnOutputSchema = z.object({
  decisions: z
    .array(DecisionSchema)
    .describe("At most one per instrument; empty means hold"),
  /** Probability that the new lines held a market-moving statement. */
  signal: z.number().optional(),
});

export type Action = z.infer<typeof ActionSchema>;
export type Choice = (typeof CHOICES)[number];
export type Decision = z.infer<typeof DecisionSchema>;
export type TurnOutput = z.infer<typeof TurnOutputSchema>;

/**
 * Clamps every confidence into [0, 1] and keeps one decision per instrument:
 * the most confident, or the first on a tie. Order of first appearance is kept.
 */
export function normalizeTurnOutput(output: TurnOutput): TurnOutput {
  const best = new Map<InstrumentId, Decision>();
  for (const decision of output.decisions) {
    const confidence = Number.isFinite(decision.confidence)
      ? Math.min(1, Math.max(0, decision.confidence))
      : 0;
    const candidate = { ...decision, confidence };
    const current = best.get(decision.instrument);
    if (!current || candidate.confidence > current.confidence)
      best.set(decision.instrument, candidate);
  }
  return {
    decisions: [...best.values()],
    ...(output.signal === undefined ? {} : { signal: output.signal }),
  };
}
