import type { PriceTick, StockFeed } from "@repo/alpaca/prices";
import { DEFAULT_MODEL } from "@repo/jev/typesafe";
import type { Segment } from "@repo/transcriber";
// Argument parsing and commands. Pure: returns the output instead of printing it,
// so tests can call `run` directly. `main.ts` is the process entry point; the
// `jev` command's arguments live in `jev-args.ts`.
import { parseArgs } from "node:util";

import { parseTime } from "./time";

const usage = `Usage: pnpm cli [options]
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
  --tee               Record the replayed lines and ticks under .cache/transcripts/ and
                      .cache/prices/ as a live run would, for desk to follow
  --decider=<kind>    typesafe (default), hold, or script:<decisions.jsonl>
  --model=<id>        TypeSafe model (default: $JEV_MODEL or ${DEFAULT_MODEL})
  --cash=<usd>        Starting cash for a fresh portfolio (default: 100000)
  --size=<fraction>   Equity fraction per fill (default: 0.1)
  --sizing=<fixed|vol>  fixed: every fill is --size of equity. vol: sized so a usual
                      15-minute move costs --risk of equity, within 0.25x-2x --size
                      (default: fixed)
  --risk=<fraction>   Equity a usual 15-minute move may cost, for --sizing=vol (default: 0.002)
  --max-chase-z=<z>   Reject entries after a move of this many usual 5-minute moves
                      their way, likely priced in; 0 to disable (default: 3)
  --stop-z=<z>        Close a position down this many usual 15-minute moves, 0 to
                      disable (default: 0)
  --take-profit-z=<z> Close a position up this many usual 15-minute moves, 0 to
                      disable (default: 0)
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
const run = (argv: string[]): string => {
  const { values } = parseArgs({
    args: argv,
    options: {
      "hello-world": { type: "boolean" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values["hello-world"] === true) {
    return `Hello, ${values.name ?? "world"}!`;
  }
  return usage;
};

type TranscribeArgs = {
  url: string;
  videoId: string;
  model?: string;
  language?: string;
  chunkSeconds?: number;
  realtime: boolean;
  json: boolean;
  out?: string;
};

/** Whether an environment value is missing or empty. */
const isBlank = (value: string | undefined): value is "" | undefined =>
  value === undefined || value === "";

const youtubeHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);
const videoIdPattern = /^[\w-]{11}$/;

/** Where `url` keeps its video ID, by URL shape. */
const videoIdIn = (url: URL): string | null | undefined => {
  const [first, second] = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "youtu.be") {
    return first;
  }
  if (first === "watch") {
    return url.searchParams.get("v");
  }
  if (first === "live" || first === "shorts") {
    return second;
  }
  return undefined;
};

/**
 * Returns the video ID of a YouTube watch, live, shorts or youtu.be URL.
 * Throws for anything else.
 */
const parseYoutubeVideoId = (input: string): string => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`not a URL: ${input}`);
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !youtubeHosts.has(url.hostname)
  ) {
    throw new Error(`not a YouTube URL: ${input}`);
  }

  const id = videoIdIn(url) ?? "";
  if (!videoIdPattern.test(id)) {
    throw new Error(`no YouTube video ID in: ${input}`);
  }
  return id;
};

/** Parses `--chunk`. The worker cuts each window in its last 2 s. */
const parseChunkSeconds = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const chunkSeconds = Number(value);
  if (!Number.isFinite(chunkSeconds) || chunkSeconds <= 2) {
    throw new Error(
      `--chunk must be a number of seconds above 2, got ${value}`
    );
  }
  return chunkSeconds;
};

/** Parses the arguments after `transcribe`. Throws on invalid input. */
const parseTranscribeArgs = (argv: string[]): TranscribeArgs => {
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
  if (url === undefined) {
    throw new Error("transcribe needs a YouTube URL");
  }
  if (extra.length > 0) {
    throw new Error(`unexpected arguments: ${extra.join(" ")}`);
  }

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
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** Formats a segment as `[hh:mm:ss] text`. */
const formatSegment = (segment: Segment): string => {
  const total = Math.floor(segment.start);
  const clock = [
    Math.floor(total / 3600),
    Math.floor(total / 60) % 60,
    total % 60,
  ]
    .map(pad2)
    .join(":");
  return `[${clock}] ${segment.text}`;
};

type Range = {
  min?: number;
  max?: number;
  aboveMin?: boolean;
  integer?: boolean;
};

const parseNumber = (
  name: string,
  value: string | undefined,
  fallback: number,
  range: Range = {}
): number => {
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  const aboveMin = range.aboveMin === true;
  const integer = range.integer === true;
  const tooLow =
    range.min !== undefined &&
    (aboveMin ? number <= range.min : number < range.min);
  const tooHigh = range.max !== undefined && number > range.max;
  const notInteger = integer && !Number.isInteger(number);
  if (!Number.isFinite(number) || tooLow || tooHigh || notInteger) {
    const bounds = [
      range.min === undefined
        ? undefined
        : `${aboveMin ? "above" : "at least"} ${range.min}`,
      range.max === undefined ? undefined : `at most ${range.max}`,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new Error(
      `--${name} must be ${integer ? "an integer" : "a number"}${bounds === "" ? "" : ` ${bounds}`}, got ${value}`
    );
  }
  return number;
};

type PricesArgs = {
  json: boolean;
  /** A past window to fetch instead of streaming live. */
  history?: { from: string; to: string; barMinutes: number; feed: StockFeed };
};

/** Longest past window `prices` fetches in one go. */
const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;

/** Parses the arguments after `prices`. Throws on invalid input. */
const parsePricesArgs = (argv: string[]): PricesArgs => {
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
    if (values.bars !== undefined || values.feed !== undefined) {
      throw new Error("--bars and --feed only apply with --from and --to");
    }
    return { json };
  }
  if (values.from === undefined || values.to === undefined) {
    throw new Error("--from and --to go together");
  }
  const from = parseTime("from", values.from);
  const to = parseTime("to", values.to);
  if (!(from < to)) {
    throw new Error("--from must be earlier than --to");
  }
  if (Date.parse(to) - Date.parse(from) > MAX_HISTORY_MS) {
    throw new Error("--from and --to may be at most 24 hours apart");
  }
  const feed = values.feed ?? "sip";
  if (feed !== "sip" && feed !== "iex") {
    throw new Error(`--feed must be sip or iex, got ${feed}`);
  }
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
};

type AlpacaCredentials = { keyId: string; secretKey: string };

/** Reads the Alpaca API keys from `env`. Throws naming any that are missing. */
const alpacaCredentials = (env: NodeJS.ProcessEnv): AlpacaCredentials => {
  const keyId = env.ALPACA_API_KEY_ID;
  const secretKey = env.ALPACA_API_SECRET_KEY;
  if (isBlank(keyId) || isBlank(secretKey)) {
    const missing = [
      isBlank(keyId) ? "ALPACA_API_KEY_ID" : undefined,
      isBlank(secretKey) ? "ALPACA_API_SECRET_KEY" : undefined,
    ].filter(Boolean);
    throw new Error(
      `missing ${missing.join(" and ")}: set ${missing.length > 1 ? "them" : "it"} in the environment or in .env at the repo root`
    );
  }
  return { keyId, secretKey };
};

/**
 * Formats a tick as `hh:mm:ss  name  symbol  price  kind`, with the UTC
 * exchange time; kind is `mid` for a quote midpoint or `trade`.
 */
const formatTick = (tick: PriceTick): string =>
  [
    tick.timestamp.slice(11, 19),
    tick.name.padEnd(8),
    tick.symbol.padEnd(8),
    tick.price.toFixed(2).padStart(10),
    tick.source === "quote" ? "mid" : "trade",
  ].join("  ");

export {
  alpacaCredentials,
  formatSegment,
  formatTick,
  isBlank,
  parseChunkSeconds,
  parseNumber,
  parsePricesArgs,
  parseTranscribeArgs,
  parseYoutubeVideoId,
  run,
  usage,
};
export type { AlpacaCredentials, PricesArgs, TranscribeArgs };
