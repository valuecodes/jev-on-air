// Argument parsing and commands. Pure: returns the output instead of printing it,
// so tests can call `run` directly. `main.ts` is the process entry point.
import { parseArgs } from "node:util";
import type { PriceTick, StockFeed } from "@repo/alpaca/prices";
import { DEFAULT_MODEL } from "@repo/jev/typesafe";
import type { Segment } from "@repo/transcriber";

import { parseTime } from "./time";

export const usage = `Usage: pnpm cli [options]
       pnpm cli transcribe <youtube-url> [transcribe options]
       pnpm cli prices [--json]
       pnpm cli prices --from=<iso> --to=<iso> [--bars=<minutes>] [--json]
       pnpm cli jev <youtube-url> [jev options]
       pnpm cli jev --replay=<transcript.jsonl> [--prices=<ticks.jsonl>] [--fast] [jev options]

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
  --json              Print ticks as JSON lines
  --from=<iso> --to=<iso>  Past prices for a window instead of a live stream: one tick
                      per bar at its close (all but the last 15 minutes on the free plan)
  --bars=<minutes>    Bar length for --from/--to (default: 1)
  --feed=<sip|iex>    Stock feed for --from/--to (default: sip; the free plan needs
                      iex for the last 15 minutes)

Jev options (needs TYPESAFE_API_KEY and the Alpaca keys, e.g. in .env):
  --replay=<path>     Replay a saved transcript instead of a live stream
  --prices=<path>     Replay recorded ticks (from \`prices --json\`) instead of live ones
  --fast              Replay without waiting, on a virtual clock (needs --prices)
  --audio-start=<iso> When the transcript's audio began, to line it up with recorded
                      prices by wall-clock time (default: the transcript's .meta.json,
                      else both recordings start together)
  --lag=<seconds>     Delay every transcript line, like a live stream's delay (default: 0)
  --decider=<kind>    typesafe (default), hold, or script:<decisions.jsonl>
  --model=<id>        TypeSafe model (default: $JEV_MODEL or ${DEFAULT_MODEL})
  --cash=<usd>        Starting cash for a fresh portfolio (default: 100000)
  --size=<fraction>   Equity fraction per fill (default: 0.1)
  --min-chars=<n>     Transcript characters that trigger a turn (default: 400, at most 4000)
  --interval=<s>      Longest wait before a turn on a non-empty buffer (default: 30)
  --context=<s>       Seconds of earlier transcript the model is reminded of (default: 300)
  --min-confidence=<0-1>  Ignore decisions below this (default: 0.6)
  --min-signal=<0-1>  Reject entries when the model doubts a statement moved a market (default: 0.5)
  --max-leverage=<x>  Gross exposure cap as a multiple of equity (default: 1)
  --max-price-age=<s> Reject fills on a price older than this (default: 600)
  --snapshot=<s>      Mark-to-market interval between turns, 0 to disable (default: 60)
  --state=<path>      Portfolio file (default: .cache/jev/portfolio.json; a replay
                      uses a scratch file under .cache/jev/replay/)
  --reset             Start a fresh portfolio with --cash, ignoring the state file
  --out=<path>        Ledger file (default: .cache/jev/<id>.jsonl). A live run also
                      records its transcript and ticks under .cache/transcripts/ and
                      .cache/prices/, replayable with --replay and --prices
  --json              Print ledger events as JSON lines
  --whisper=<name> --language=<code> --chunk=<seconds>   Transcriber options (live only)`;

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

/** Parses `--chunk`. The worker cuts each window in its last 2 s. */
function parseChunkSeconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const chunkSeconds = Number(value);
  if (!Number.isFinite(chunkSeconds) || chunkSeconds <= 2)
    throw new Error(
      `--chunk must be a number of seconds above 2, got ${value}`
    );
  return chunkSeconds;
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

  return {
    url,
    videoId: parseYoutubeVideoId(url),
    model: values.model,
    language: values.language,
    chunkSeconds: parseChunkSeconds(values.chunk),
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

type Range = {
  min?: number;
  max?: number;
  aboveMin?: boolean;
  integer?: boolean;
};

function parseNumber(
  name: string,
  value: string | undefined,
  fallback: number,
  range: Range = {}
): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  const tooLow =
    range.min !== undefined &&
    (range.aboveMin ? number <= range.min : number < range.min);
  const tooHigh = range.max !== undefined && number > range.max;
  const notInteger = range.integer === true && !Number.isInteger(number);
  if (!Number.isFinite(number) || tooLow || tooHigh || notInteger) {
    const bounds = [
      range.min === undefined
        ? undefined
        : `${range.aboveMin ? "above" : "at least"} ${range.min}`,
      range.max === undefined ? undefined : `at most ${range.max}`,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `--${name} must be ${range.integer ? "an integer" : "a number"}${bounds ? ` ${bounds}` : ""}, got ${value}`
    );
  }
  return number;
}

export type PricesArgs = {
  json: boolean;
  /** A past window to fetch instead of streaming live. */
  history?: { from: string; to: string; barMinutes: number; feed: StockFeed };
};

/** Longest past window `prices` fetches in one go. */
export const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;

/** Parses the arguments after `prices`. Throws on invalid input. */
export function parsePricesArgs(argv: string[]): PricesArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      bars: { type: "string" },
      feed: { type: "string" },
    },
    strict: true,
  });
  const json = values.json ?? false;
  if (values.from === undefined && values.to === undefined) {
    if (values.bars !== undefined || values.feed !== undefined)
      throw new Error("--bars and --feed only apply with --from and --to");
    return { json };
  }
  if (values.from === undefined || values.to === undefined)
    throw new Error("--from and --to go together");
  const from = parseTime("from", values.from);
  const to = parseTime("to", values.to);
  if (!(from < to)) throw new Error("--from must be earlier than --to");
  if (Date.parse(to) - Date.parse(from) > MAX_HISTORY_MS)
    throw new Error("--from and --to may be at most 24 hours apart");
  const feed = values.feed ?? "sip";
  if (feed !== "sip" && feed !== "iex")
    throw new Error(`--feed must be sip or iex, got ${feed}`);
  return {
    json,
    history: {
      from,
      to,
      feed,
      barMinutes: parseNumber("bars", values.bars, 1, {
        min: 1,
        max: 59,
        integer: true,
      }),
    },
  };
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

export type JevSource =
  | { kind: "live"; url: string; videoId: string }
  | {
      kind: "replay";
      transcript: string;
      prices?: string;
      fast: boolean;
      /** RFC 3339 time the audio began, aligning it with the ticks. */
      audioStart?: string;
      lagSeconds: number;
    };

export type JevDecider =
  { kind: "typesafe" } | { kind: "hold" } | { kind: "script"; path: string };

export type JevArgs = {
  source: JevSource;
  /** Names the ledger and scratch state: the video id or the transcript's stem. */
  id: string;
  decider: JevDecider;
  model?: string;
  whisper?: string;
  language?: string;
  chunkSeconds?: number;
  cash: number;
  size: number;
  minChars: number;
  intervalSeconds: number;
  contextSeconds: number;
  minConfidence: number;
  minSignal: number;
  maxLeverage: number;
  maxPriceAgeSeconds: number;
  snapshotSeconds: number;
  state?: string;
  reset: boolean;
  out?: string;
  json: boolean;
};

function parseDecider(value: string | undefined): JevDecider {
  if (value === undefined || value === "typesafe") return { kind: "typesafe" };
  if (value === "hold") return { kind: "hold" };
  if (value.startsWith("script:") && value.length > "script:".length)
    return { kind: "script", path: value.slice("script:".length) };
  throw new Error(
    `--decider must be typesafe, hold or script:<path>, got ${value}`
  );
}

/** Parses the arguments after `jev`. Throws on invalid input. */
export function parseJevArgs(argv: string[]): JevArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      replay: { type: "string" },
      prices: { type: "string" },
      fast: { type: "boolean" },
      "audio-start": { type: "string" },
      lag: { type: "string" },
      decider: { type: "string" },
      model: { type: "string" },
      whisper: { type: "string" },
      language: { type: "string" },
      chunk: { type: "string" },
      cash: { type: "string" },
      size: { type: "string" },
      "min-chars": { type: "string" },
      interval: { type: "string" },
      context: { type: "string" },
      "min-confidence": { type: "string" },
      "min-signal": { type: "string" },
      "max-leverage": { type: "string" },
      "max-price-age": { type: "string" },
      snapshot: { type: "string" },
      state: { type: "string" },
      reset: { type: "boolean" },
      out: { type: "string" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });

  const [url, ...extra] = positionals;
  if (extra.length > 0)
    throw new Error(`unexpected arguments: ${extra.join(" ")}`);
  for (const [name, value] of Object.entries(values))
    if (value === "") throw new Error(`--${name} needs a value`);
  if (url !== undefined && values.replay !== undefined)
    throw new Error("jev takes a YouTube URL or --replay, not both");
  if (url === undefined && values.replay === undefined)
    throw new Error("jev needs a YouTube URL or --replay=<transcript.jsonl>");
  if (values.replay === undefined) {
    if (
      values.prices !== undefined ||
      values.fast ||
      values["audio-start"] !== undefined ||
      values.lag !== undefined
    )
      throw new Error(
        "--prices, --fast, --audio-start and --lag only apply to --replay"
      );
  } else if (
    values.whisper !== undefined ||
    values.language !== undefined ||
    values.chunk !== undefined
  ) {
    throw new Error(
      "--whisper, --language and --chunk only apply to a live stream"
    );
  }
  if (values.fast && values.prices === undefined)
    throw new Error(
      "--fast needs --prices: a virtual clock cannot pace a live feed"
    );

  let source: JevSource;
  let id: string;
  if (url !== undefined) {
    const videoId = parseYoutubeVideoId(url);
    source = { kind: "live", url, videoId };
    id = videoId;
  } else {
    const transcript = values.replay ?? "";
    source = {
      kind: "replay",
      transcript,
      ...(values.prices === undefined ? {} : { prices: values.prices }),
      fast: values.fast ?? false,
      ...(values["audio-start"] === undefined
        ? {}
        : { audioStart: parseTime("audio-start", values["audio-start"]) }),
      lagSeconds: parseNumber("lag", values.lag, 0, { min: 0 }),
    };
    id =
      transcript
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.jsonl$/, "") ?? "replay";
  }

  return {
    source,
    id,
    decider: parseDecider(values.decider),
    model: values.model,
    whisper: values.whisper,
    language: values.language,
    chunkSeconds: parseChunkSeconds(values.chunk),
    cash: parseNumber("cash", values.cash, 100_000, { min: 0, aboveMin: true }),
    size: parseNumber("size", values.size, 0.1, {
      min: 0,
      aboveMin: true,
      max: 1,
    }),
    minChars: parseNumber("min-chars", values["min-chars"], 400, {
      min: 1,
      max: 4000,
      integer: true,
    }),
    intervalSeconds: parseNumber("interval", values.interval, 30, { min: 5 }),
    contextSeconds: parseNumber("context", values.context, 300, { min: 0 }),
    minConfidence: parseNumber(
      "min-confidence",
      values["min-confidence"],
      0.6,
      { min: 0, max: 1 }
    ),
    minSignal: parseNumber("min-signal", values["min-signal"], 0.5, {
      min: 0,
      max: 1,
    }),
    maxLeverage: parseNumber("max-leverage", values["max-leverage"], 1, {
      min: 0,
      aboveMin: true,
    }),
    maxPriceAgeSeconds: parseNumber(
      "max-price-age",
      values["max-price-age"],
      600,
      { min: 0, aboveMin: true }
    ),
    snapshotSeconds: parseNumber("snapshot", values.snapshot, 60, { min: 0 }),
    state: values.state,
    reset: values.reset ?? false,
    out: values.out,
    json: values.json ?? false,
  };
}

/** Reads the TypeSafe API key from `env`. Throws if it is missing. */
export function typesafeApiKey(env: NodeJS.ProcessEnv): string {
  const apiKey = env.TYPESAFE_API_KEY;
  if (!apiKey)
    throw new Error(
      "missing TYPESAFE_API_KEY: set it in the environment or in .env at the repo root"
    );
  return apiKey;
}

/** `JEV_MODEL`, unless it is blank as in `.env.example`. */
function configuredModel(env: NodeJS.ProcessEnv): string | undefined {
  const model = env.JEV_MODEL?.trim();
  if (model === undefined || model === "") return undefined;
  return model;
}

/** What a `jev` run needs from the environment. */
export type JevConfig = {
  /** Only when prices are live. */
  alpaca?: AlpacaCredentials;
  /** Only when the TypeSafe decider is used. */
  typesafeApiKey?: string;
  model: string;
};

/** Resolves credentials and the model for `args`; throws naming what is missing. */
export function jevConfig(args: JevArgs, env: NodeJS.ProcessEnv): JevConfig {
  const livePrices =
    args.source.kind === "live" || args.source.prices === undefined;
  return {
    ...(livePrices ? { alpaca: alpacaCredentials(env) } : {}),
    ...(args.decider.kind === "typesafe"
      ? { typesafeApiKey: typesafeApiKey(env) }
      : {}),
    model: args.model ?? configuredModel(env) ?? DEFAULT_MODEL,
  };
}
