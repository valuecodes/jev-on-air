// Argument parsing and commands. Pure: returns the output instead of printing it,
// so tests can call `run` directly. `main.ts` is the process entry point.
import { parseArgs } from "node:util";
import type { PriceTick } from "@repo/alpaca/prices";
import type { Segment } from "@repo/transcriber";

export const usage = `Usage: pnpm cli [options]
       pnpm cli transcribe <youtube-url> [transcribe options]
       pnpm cli prices [--json]

Options:
  --hello-world    Print a greeting
  --name=<name>    Who to greet with --hello-world (default: world)
  -h, --help       Show this message

Transcribe options:
  --model=<name>      faster-whisper model (default: small)
  --language=<code>   Spoken language, e.g. en (default: detect)
  --chunk=<seconds>   Audio per transcription window (default: 8)
  --realtime          Pace a finished video like a live stream
  --json              Print segments as JSON lines
  --out=<path>        Transcript file (default: .cache/transcripts/<id>.jsonl)

Prices options (needs ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY, e.g. in .env):
  --json              Print ticks as JSON lines`;

/** Parses `argv` and returns the text to print. Throws on unknown flags. */
export function run(argv: string[]): string {
  const { values } = parseArgs({
    args: argv,
    options: {
      "hello-world": { type: "boolean" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values["hello-world"]) return `Hello, ${values.name ?? "world"}!`;
  return usage;
}

export type TranscribeArgs = {
  url: string;
  videoId: string;
  model?: string;
  language?: string;
  chunkSeconds?: number;
  realtime: boolean;
  json: boolean;
  out?: string;
};

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
const videoIdPattern = /^[\w-]{11}$/;

/**
 * Returns the video ID of a YouTube watch, live, shorts or youtu.be URL.
 * Throws for anything else.
 */
export function parseYoutubeVideoId(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`not a URL: ${input}`);
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !youtubeHosts.has(url.hostname)
  )
    throw new Error(`not a YouTube URL: ${input}`);

  const [first, second] = url.pathname.split("/").filter(Boolean);
  const id =
    url.hostname === "youtu.be"
      ? first
      : first === "watch"
        ? url.searchParams.get("v")
        : first === "live" || first === "shorts"
          ? second
          : undefined;
  if (!id || !videoIdPattern.test(id))
    throw new Error(`no YouTube video ID in: ${input}`);
  return id;
}

/** Parses the arguments after `transcribe`. Throws on invalid input. */
export function parseTranscribeArgs(argv: string[]): TranscribeArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      model: { type: "string" },
      language: { type: "string" },
      chunk: { type: "string" },
      realtime: { type: "boolean" },
      json: { type: "boolean" },
      out: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });

  const [url, ...extra] = positionals;
  if (url === undefined) throw new Error("transcribe needs a YouTube URL");
  if (extra.length > 0)
    throw new Error(`unexpected arguments: ${extra.join(" ")}`);

  let chunkSeconds: number | undefined;
  if (values.chunk !== undefined) {
    chunkSeconds = Number(values.chunk);
    // The worker searches the last 2 s of each window for a quiet cut point.
    if (!Number.isFinite(chunkSeconds) || chunkSeconds <= 2)
      throw new Error(
        `--chunk must be a number of seconds above 2, got ${values.chunk}`
      );
  }

  return {
    url,
    videoId: parseYoutubeVideoId(url),
    model: values.model,
    language: values.language,
    chunkSeconds,
    realtime: values.realtime ?? false,
    json: values.json ?? false,
    out: values.out,
  };
}

/** Formats a segment as `[hh:mm:ss] text`. */
export function formatSegment(segment: Segment): string {
  const total = Math.floor(segment.start);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = [
    Math.floor(total / 3600),
    Math.floor(total / 60) % 60,
    total % 60,
  ]
    .map(pad)
    .join(":");
  return `[${clock}] ${segment.text}`;
}

export type PricesArgs = { json: boolean };

/** Parses the arguments after `prices`. Throws on invalid input. */
export function parsePricesArgs(argv: string[]): PricesArgs {
  const { values } = parseArgs({
    args: argv,
    options: { json: { type: "boolean" } },
    strict: true,
  });
  return { json: values.json ?? false };
}

export type AlpacaCredentials = { keyId: string; secretKey: string };

/** Reads the Alpaca API keys from `env`. Throws naming any that are missing. */
export function alpacaCredentials(env: NodeJS.ProcessEnv): AlpacaCredentials {
  const keyId = env.ALPACA_API_KEY_ID;
  const secretKey = env.ALPACA_API_SECRET_KEY;
  if (!keyId || !secretKey) {
    const missing = [
      keyId ? undefined : "ALPACA_API_KEY_ID",
      secretKey ? undefined : "ALPACA_API_SECRET_KEY",
    ].filter(Boolean);
    throw new Error(
      `missing ${missing.join(" and ")}: set ${missing.length > 1 ? "them" : "it"} in the environment or in .env at the repo root`
    );
  }
  return { keyId, secretKey };
}

/**
 * Formats a tick as `hh:mm:ss  name  symbol  price  kind`, with the UTC
 * exchange time; kind is `mid` for a quote midpoint or `trade`.
 */
export function formatTick(tick: PriceTick): string {
  return [
    tick.timestamp.slice(11, 19),
    tick.name.padEnd(8),
    tick.symbol.padEnd(8),
    tick.price.toFixed(2).padStart(10),
    tick.source === "quote" ? "mid" : "trade",
  ].join("  ");
}
