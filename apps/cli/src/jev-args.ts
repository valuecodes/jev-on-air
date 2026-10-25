// The `jev` command's arguments and the configuration it reads from the
// environment. Pure, like `cli.ts`, so tests can call it directly.

import { DEFAULT_MODEL } from "@repo/jev/typesafe";
import { parseArgs } from "node:util";

import {
  alpacaCredentials,
  isBlank,
  parseChunkSeconds,
  parseNumber,
  parseYoutubeVideoId,
} from "./cli";
import type { AlpacaCredentials } from "./cli";
import { parseTime } from "./time";

type JevSource =
  | { kind: "live"; url: string; videoId: string }
  | {
      kind: "replay";
      transcript: string;
      prices?: string;
      fast: boolean;
      /** RFC 3339 time the audio began, aligning it with the ticks. */
      audioStart?: string;
      lagSeconds: number;
      /** Record what is replayed as a live run records what it hears. */
      tee: boolean;
    };

type JevDecider =
  | { kind: "typesafe" }
  | { kind: "hold" }
  | { kind: "script"; path: string };

type JevArgs = {
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
  sizing: "fixed" | "vol";
  risk: number;
  maxChaseZ: number;
  stopZ: number;
  takeProfitZ: number;
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

const parseDecider = (value: string | undefined): JevDecider => {
  if (value === undefined || value === "typesafe") {
    return { kind: "typesafe" };
  }
  if (value === "hold") {
    return { kind: "hold" };
  }
  if (value.startsWith("script:") && value.length > "script:".length) {
    return { kind: "script", path: value.slice("script:".length) };
  }
  throw new Error(
    `--decider must be typesafe, hold or script:<path>, got ${value}`
  );
};

/** Parses the arguments after `jev`. Throws on invalid input. */
const parseJevArgs = (argv: string[]): JevArgs => {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      replay: { type: "string" },
      prices: { type: "string" },
      fast: { type: "boolean" },
      "audio-start": { type: "string" },
      lag: { type: "string" },
      tee: { type: "boolean" },
      decider: { type: "string" },
      model: { type: "string" },
      whisper: { type: "string" },
      language: { type: "string" },
      chunk: { type: "string" },
      cash: { type: "string" },
      size: { type: "string" },
      sizing: { type: "string" },
      risk: { type: "string" },
      "max-chase-z": { type: "string" },
      "stop-z": { type: "string" },
      "take-profit-z": { type: "string" },
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
  if (extra.length > 0) {
    throw new Error(`unexpected arguments: ${extra.join(" ")}`);
  }
  for (const [name, value] of Object.entries(values)) {
    if (value === "") {
      throw new Error(`--${name} needs a value`);
    }
  }
  if (url !== undefined && values.replay !== undefined) {
    throw new Error("jev takes a YouTube URL or --replay, not both");
  }
  if (url === undefined && values.replay === undefined) {
    throw new Error("jev needs a YouTube URL or --replay=<transcript.jsonl>");
  }
  const fast = values.fast ?? false;
  const tee = values.tee ?? false;
  if (values.replay === undefined) {
    if (
      values.prices !== undefined ||
      fast ||
      values["audio-start"] !== undefined ||
      values.lag !== undefined ||
      tee
    ) {
      throw new Error(
        "--prices, --fast, --audio-start, --lag and --tee only apply to --replay"
      );
    }
  } else if (
    values.whisper !== undefined ||
    values.language !== undefined ||
    values.chunk !== undefined
  ) {
    throw new Error(
      "--whisper, --language and --chunk only apply to a live stream"
    );
  }
  const sizing = values.sizing ?? "fixed";
  if (sizing !== "fixed" && sizing !== "vol") {
    throw new Error(`--sizing must be fixed or vol, got ${sizing}`);
  }
  if (values.risk !== undefined && sizing !== "vol") {
    throw new Error("--risk only applies to --sizing=vol");
  }
  if (fast && values.prices === undefined) {
    throw new Error(
      "--fast needs --prices: a virtual clock cannot pace a live feed"
    );
  }

  let source: JevSource;
  let id: string;
  if (url === undefined) {
    const transcript = values.replay ?? "";
    source = {
      kind: "replay",
      transcript,
      ...(values.prices === undefined ? {} : { prices: values.prices }),
      fast,
      ...(values["audio-start"] === undefined
        ? {}
        : { audioStart: parseTime("audio-start", values["audio-start"]) }),
      lagSeconds: parseNumber("lag", values.lag, 0, { min: 0 }),
      tee,
    };
    id =
      transcript
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.jsonl$/, "") ?? "replay";
  } else {
    const videoId = parseYoutubeVideoId(url);
    source = { kind: "live", url, videoId };
    id = videoId;
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
    sizing,
    risk: parseNumber("risk", values.risk, 0.002, {
      min: 0,
      aboveMin: true,
      max: 1,
    }),
    maxChaseZ: parseNumber("max-chase-z", values["max-chase-z"], 3, {
      min: 0,
    }),
    stopZ: parseNumber("stop-z", values["stop-z"], 0, { min: 0 }),
    takeProfitZ: parseNumber("take-profit-z", values["take-profit-z"], 0, {
      min: 0,
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
};

/** Reads the TypeSafe API key from `env`. Throws if it is missing. */
const typesafeApiKey = (env: NodeJS.ProcessEnv): string => {
  const apiKey = env.TYPESAFE_API_KEY;
  if (isBlank(apiKey)) {
    throw new Error(
      "missing TYPESAFE_API_KEY: set it in the environment or in .env at the repo root"
    );
  }
  return apiKey;
};

/** `JEV_MODEL`, unless it is blank as in `.env.example`. */
const configuredModel = (env: NodeJS.ProcessEnv): string | undefined => {
  const model = env.JEV_MODEL?.trim();
  return isBlank(model) ? undefined : model;
};

/** What a `jev` run needs from the environment. */
type JevConfig = {
  /** Only when prices are live. */
  alpaca?: AlpacaCredentials;
  /** Only when the TypeSafe decider is used. */
  typesafeApiKey?: string;
  model: string;
};

/** Resolves credentials and the model for `args`; throws naming what is missing. */
const jevConfig = (args: JevArgs, env: NodeJS.ProcessEnv): JevConfig => {
  const livePrices =
    args.source.kind === "live" || args.source.prices === undefined;
  return {
    ...(livePrices ? { alpaca: alpacaCredentials(env) } : {}),
    ...(args.decider.kind === "typesafe"
      ? { typesafeApiKey: typesafeApiKey(env) }
      : {}),
    model: args.model ?? configuredModel(env) ?? DEFAULT_MODEL,
  };
};

export { jevConfig, parseJevArgs, typesafeApiKey };
export type { JevArgs, JevConfig };
