// What the "New run" form and the sample buttons may ask for, and the CLI
// arguments they turn into. Only these fields reach the CLI; everything else
// keeps the CLI's defaults.
import { join } from "node:path";
import { z } from "zod";

import { cliDir } from "./paths";
import { findSample, SAMPLE_MODES } from "./samples";
import type { SampleMode } from "./samples";
import { parseYoutubeVideoId, watchUrl } from "./youtube";

const options = {
  size: z.number().gt(0).lte(1).optional(),
  minSignal: z.number().min(0).max(1).optional(),
};

const LiveRequestSchema = z.strictObject({
  url: z.string().trim().min(1).max(2048),
  ...options,
  reset: z.boolean().optional(),
});

const SampleRequestSchema = z.strictObject({
  sample: z.string().refine((id) => findSample(id) !== undefined, {
    message: "unknown sample",
  }),
  mode: z.enum(SAMPLE_MODES),
  ...options,
});

const StartRequestSchema = z.union([LiveRequestSchema, SampleRequestSchema]);

export type StartRequest = {
  /** The ledger id: the YouTube video id, or a sample's id. */
  videoId: string;
  size?: number;
  minSignal?: number;
  reset: boolean;
  /** Set when replaying a recorded sample instead of a live stream. */
  sample?: { mode: SampleMode; lagSeconds: number };
};

/** Validates a start request body. Throws with a readable message. */
export function parseStartRequest(body: unknown): StartRequest {
  const parsed = StartRequestSchema.safeParse(body);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  const { size, minSignal } = parsed.data;
  const common = {
    ...(size === undefined ? {} : { size }),
    ...(minSignal === undefined ? {} : { minSignal }),
  };
  if ("sample" in parsed.data) {
    const sample = findSample(parsed.data.sample);
    if (!sample) throw new Error("unknown sample");
    return {
      videoId: sample.id,
      ...common,
      // A sample always trades its own scratch book from fresh cash.
      reset: true,
      sample: { mode: parsed.data.mode, lagSeconds: sample.lagSeconds },
    };
  }
  return {
    videoId: parseYoutubeVideoId(parsed.data.url),
    ...common,
    reset: parsed.data.reset ?? false,
  };
}

/**
 * Prices older than this reject a fill. A paced replay starts this long
 * before the first line, so a sample keeps it short: its ticks are 1-minute
 * bars.
 */
const SAMPLE_MAX_PRICE_AGE_SECONDS = 120;

/**
 * `node` arguments for `pnpm cli jev`, run from apps/cli. Node runs the CLI
 * itself (not through pnpm or the tsx wrapper), so a signal sent to its
 * process group reaches the CLI's own abort handler. The URL is rebuilt from
 * the video id and sample paths from the registry's id, so nothing
 * user-typed reaches the argument list.
 */
export function jevArgv(request: StartRequest): string[] {
  const source = request.sample
    ? [
        `--replay=${join(cliDir, "samples", `${request.videoId}.jsonl`)}`,
        `--prices=${join(cliDir, "samples", `${request.videoId}.ticks.jsonl`)}`,
        `--lag=${request.sample.lagSeconds}`,
        `--max-price-age=${SAMPLE_MAX_PRICE_AGE_SECONDS}`,
        "--tee",
        ...(request.sample.mode === "fast" ? ["--fast"] : []),
      ]
    : [watchUrl(request.videoId)];
  return [
    "--import",
    "tsx",
    "src/main.ts",
    "jev",
    ...source,
    ...(request.size === undefined ? [] : [`--size=${request.size}`]),
    ...(request.minSignal === undefined
      ? []
      : [`--min-signal=${request.minSignal}`]),
    ...(request.reset ? ["--reset"] : []),
  ];
}
