// What the "New run" form may ask for, and the CLI arguments it turns into.
// Only these fields reach the CLI; everything else keeps the CLI's defaults.
import { z } from "zod";

import { parseYoutubeVideoId, watchUrl } from "./youtube";

const StartRequestSchema = z.strictObject({
  url: z.string().trim().min(1).max(2048),
  size: z.number().gt(0).lte(1).optional(),
  minSignal: z.number().min(0).max(1).optional(),
  reset: z.boolean().optional(),
});

export type StartRequest = {
  videoId: string;
  size?: number;
  minSignal?: number;
  reset: boolean;
};

/** Validates a start request body. Throws with a readable message. */
export function parseStartRequest(body: unknown): StartRequest {
  const parsed = StartRequestSchema.safeParse(body);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  const { url, size, minSignal, reset } = parsed.data;
  return {
    videoId: parseYoutubeVideoId(url),
    ...(size === undefined ? {} : { size }),
    ...(minSignal === undefined ? {} : { minSignal }),
    reset: reset ?? false,
  };
}

/**
 * `node` arguments for `pnpm cli jev <url>`, run from apps/cli. Node runs
 * the CLI itself (not through pnpm or the tsx wrapper), so a signal sent to
 * its process group reaches the CLI's own abort handler. The URL is rebuilt
 * from the video id, so nothing user-typed reaches the argument list.
 */
export function jevArgv(request: StartRequest): string[] {
  return [
    "--import",
    "tsx",
    "src/main.ts",
    "jev",
    watchUrl(request.videoId),
    ...(request.size === undefined ? [] : [`--size=${request.size}`]),
    ...(request.minSignal === undefined
      ? []
      : [`--min-signal=${request.minSignal}`]),
    ...(request.reset ? ["--reset"] : []),
  ];
}
