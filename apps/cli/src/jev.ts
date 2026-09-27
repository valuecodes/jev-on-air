// The `jev` command: runs the decision engine over a live stream or a
// recording, keeps the portfolio in a state file and writes every event to
// a ledger and to stdout.
import { once } from "node:events";
import { basename, join, resolve } from "node:path";
import { PriceFeed } from "@repo/alpaca/prices";
import { HoldDecider, ScriptedDecider } from "@repo/jev/decider";
import type { Decider } from "@repo/jev/decider";
import { Engine } from "@repo/jev/engine";
import type { EngineEvent } from "@repo/jev/engine";
import { formatEvent } from "@repo/jev/ledger";
import { interval, mapSource, merge } from "@repo/jev/merge";
import type { Source } from "@repo/jev/merge";
import { fractionOfEquity, Portfolio } from "@repo/jev/portfolio";
import {
  clipTimeline,
  fast,
  paced,
  parseTickLine,
  rebase,
  segmentTimeline,
  tickTimeline,
} from "@repo/jev/replay";
import { TurnOutputSchema } from "@repo/jev/schema";
import { StateFile } from "@repo/jev/state";
import { TypeSafeDecider } from "@repo/jev/typesafe";
import type { LoggerLike } from "@repo/logger";
import { parseSegmentLine, Transcriber } from "@repo/transcriber";

import type { JevArgs, JevConfig } from "./cli";
import { JsonlWriter, readJsonlAs } from "./jsonl";
import { readSidecar, sidecarPath, writeSidecar } from "./sidecar";
import type { Sidecar } from "./sidecar";
import { childEnv } from "./time";
import { describeVideo } from "./transcribe";

const cacheDir = join(import.meta.dirname, "..", ".cache");

/** Where the run reads and writes, all resolved to absolute paths. */
type Paths = {
  ledger: string;
  state: string;
  transcript?: string;
  prices?: string;
  script?: string;
  /**
   * Live runs tee their transcript here, so any run can be replayed; a
   * replay with `--tee` records what it replays, for desk to follow.
   */
  tee?: string;
  /** ...and their price ticks here, in the `prices --json` format. */
  ticks?: string;
};

function paths(args: JevArgs): Paths {
  // `pnpm cli` runs from apps/cli; INIT_CWD is where the user typed it.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const jevDir = join(cacheDir, "jev");
  const live = args.source.kind === "live";
  const result: Paths = {
    ledger: args.out
      ? resolve(cwd, args.out)
      : join(jevDir, `${args.id}.jsonl`),
    state: args.state
      ? resolve(cwd, args.state)
      : live
        ? join(jevDir, "portfolio.json")
        : join(jevDir, "replay", `${args.id}.state.json`),
  };
  if (args.source.kind === "replay") {
    result.transcript = resolve(cwd, args.source.transcript);
    if (args.source.prices) result.prices = resolve(cwd, args.source.prices);
    if (args.source.tee) {
      result.tee = join(cacheDir, "transcripts", `${args.id}.jsonl`);
      result.ticks = join(cacheDir, "prices", `${args.id}.jsonl`);
    }
  } else {
    result.tee = join(cacheDir, "transcripts", `${args.source.videoId}.jsonl`);
    result.ticks = join(cacheDir, "prices", `${args.source.videoId}.jsonl`);
  }
  if (args.decider.kind === "script")
    result.script = resolve(cwd, args.decider.path);

  const seen = new Map<string, string>();
  for (const [name, path] of Object.entries(result)) {
    const other = seen.get(path);
    if (other !== undefined)
      throw new Error(`${name} and ${other} are the same file: ${path}`);
    seen.set(path, name);
  }
  return result;
}

export class JevCommand {
  private readonly logger: LoggerLike;

  constructor(logger: LoggerLike) {
    this.logger = logger;
  }

  async run(
    args: JevArgs,
    config: JevConfig,
    signal?: AbortSignal
  ): Promise<void> {
    const files = paths(args);
    const run = new Date().toISOString();
    // A replay gets a scratch book unless a state file is named, so it never
    // trades on top of the live portfolio. The lock keeps two runs from
    // saving over each other's fills.
    const stateFile = new StateFile(files.state);
    const unlock = await stateFile.lock();
    try {
      await this.runLocked(args, config, files, stateFile, run, signal);
    } finally {
      await unlock();
    }
  }

  private async runLocked(
    args: JevArgs,
    config: JevConfig,
    files: Paths,
    stateFile: StateFile,
    run: string,
    signal?: AbortSignal
  ): Promise<void> {
    const sizer = fractionOfEquity(args.size);
    const book = { sizer, maxLeverage: args.maxLeverage };
    const resume =
      !args.reset && (args.source.kind === "live" || args.state !== undefined);
    const saved = resume ? await stateFile.load() : undefined;
    const portfolio = saved
      ? Portfolio.fromState(saved, book)
      : new Portfolio({ ...book, cash: args.cash });
    if (saved) {
      this.logger.info("resuming portfolio; --cash is ignored", {
        state: files.state,
        ...portfolio.markToMarket({}),
      });
    } else {
      this.logger.info("starting a fresh portfolio", {
        state: files.state,
        cash: args.cash,
      });
    }
    await stateFile.save(portfolio.toState(run, run));

    const decider = await this.decider(args, config, files);
    const { events, clock, awaitDecisions } = await this.events(
      args,
      config,
      files
    );

    const ledger = await JsonlWriter.open(files.ledger);
    this.logger.info("writing ledger", { ledger: files.ledger });
    const engine = new Engine(this.logger, {
      events,
      decider,
      portfolio,
      trigger: {
        minChars: args.minChars,
        maxWaitMs: args.intervalSeconds * 1000,
      },
      minConfidence: args.minConfidence,
      minSignal: args.minSignal,
      contextSeconds: args.contextSeconds,
      maxPriceAgeMs: args.maxPriceAgeSeconds * 1000,
      snapshotIntervalMs: args.snapshotSeconds * 1000,
      awaitDecisions,
      clock,
      run,
      source:
        args.source.kind === "live"
          ? `youtube:${args.source.videoId}`
          : `replay:${basename(args.source.transcript)}`,
      model:
        args.decider.kind === "typesafe" ? config.model : args.decider.kind,
      size: args.size,
      resumed: saved !== undefined,
      onEvent: async (event) => {
        // The book is saved before the ledger line, so a crash between the
        // two leaves a fill the ledger does not know about, never the reverse.
        if (event.type === "fill" || event.type === "end")
          await stateFile.save(portfolio.toState(event.time, run));
        await ledger.append(event);
        const line = `${args.json ? JSON.stringify(event) : formatEvent(event)}\n`;
        // Wait out a slow pipe rather than queueing output in memory.
        if (!process.stdout.write(line)) await once(process.stdout, "drain");
      },
    });
    try {
      const final = await engine.run(signal);
      this.logger.info("run finished", { run, ...final, positions: undefined });
    } finally {
      await ledger.close();
    }
  }

  private async decider(
    args: JevArgs,
    config: JevConfig,
    files: Paths
  ): Promise<Decider> {
    switch (args.decider.kind) {
      case "hold":
        return new HoldDecider();
      case "script": {
        const outputs = await readJsonlAs(files.script ?? "", (line) =>
          TurnOutputSchema.parse(JSON.parse(line))
        );
        return new ScriptedDecider(outputs);
      }
      case "typesafe":
        return new TypeSafeDecider(this.logger, {
          apiKey: config.typesafeApiKey,
          model: config.model,
        });
    }
  }

  private async events(
    args: JevArgs,
    config: JevConfig,
    files: Paths
  ): Promise<{
    events: Source<EngineEvent>;
    clock: (() => number) | undefined;
    awaitDecisions: boolean;
  }> {
    const heartbeat: Source<EngineEvent> = mapSource(interval(1000), () => ({
      kind: "heartbeat",
    }));
    const ticks = (): Source<EngineEvent> => {
      if (!config.alpaca) throw new Error("live prices need Alpaca keys");
      const feed = new PriceFeed(this.logger, { credentials: config.alpaca });
      return mapSource(
        (signal) => feed.stream(signal),
        (tick) => ({ kind: "tick", tick })
      );
    };

    if (args.source.kind === "live") {
      const { url } = args.source;
      const transcriber = new Transcriber(this.logger, {
        model: args.whisper,
        language: args.language,
        chunkSeconds: args.chunkSeconds,
        env: childEnv(process.env),
      });
      const tee = await JsonlWriter.open(files.tee ?? "");
      this.logger.info("writing transcript", { out: files.tee });
      const logger = this.logger;
      const teePath = files.tee ?? "";
      const segments: Source<EngineEvent> = async function* (signal) {
        try {
          const sidecar = await describeVideo(logger, transcriber, url, signal);
          let described = false;
          for await (const segment of transcriber.transcribe(url, signal)) {
            await tee.append(segment);
            if (sidecar && !described) {
              described = true;
              await writeSidecar(sidecarPath(teePath), sidecar);
            }
            yield { kind: "segment", segment };
          }
        } finally {
          await tee.close();
        }
      };
      const prices = ticks();
      const record = await JsonlWriter.open(files.ticks ?? "");
      this.logger.info("writing ticks", { out: files.ticks });
      const recorded: Source<EngineEvent> = async function* (signal) {
        try {
          for await (const event of prices(signal)) {
            if (event.kind === "tick") await record.append(event.tick);
            yield event;
          }
        } finally {
          await record.close();
        }
      };
      return {
        events: merge([segments, recorded, heartbeat], { primary: 0 }),
        clock: undefined,
        awaitDecisions: false,
      };
    }

    const { lagSeconds } = args.source;
    // The audio's start: given, or recorded next to the transcript.
    const sidecar = await readSidecar(sidecarPath(files.transcript ?? ""));
    let audioStart = args.source.audioStart;
    if (audioStart === undefined) {
      audioStart = sidecar?.audioStart;
      if (audioStart !== undefined)
        this.logger.info("audio start from the transcript's sidecar", {
          audioStart,
          title: sidecar?.video.title,
        });
    }
    const originMs =
      audioStart === undefined ? undefined : Date.parse(audioStart);
    const transcript = segmentTimeline(
      await readJsonlAs(files.transcript ?? "", parseSegmentLine),
      (message, fields) => {
        this.logger.warn(message, fields);
      },
      lagSeconds * 1000
    );
    const allPrices =
      files.prices === undefined
        ? undefined
        : tickTimeline(
            await readJsonlAs(files.prices, parseTickLine),
            originMs
          );
    // A live run's tick file holds every session for its video. Lined up by
    // the audio start, keep the ticks this transcript could have seen: from
    // the oldest price a fill may use until a minute after its last line.
    const prices =
      allPrices && originMs !== undefined
        ? clipTimeline(
            allPrices,
            -args.maxPriceAgeSeconds * 1000,
            (transcript.at(-1)?.at ?? 0) + 60_000
          )
        : allPrices;
    this.logger.info("replaying", {
      transcript: files.transcript,
      segments: transcript.length,
      prices: files.prices,
      ticks: prices?.length,
      fast: args.source.fast,
      audioStart,
      lagSeconds,
    });
    const record = args.source.tee
      ? await this.tee(files, sidecar, audioStart)
      : (events: Source<EngineEvent>) => events;
    if (args.source.fast) {
      const replay = fast([transcript, prices ?? []], {
        heartbeatMs: 1000,
        startAt: originMs ?? Date.now(),
        primary: 0,
      });
      return {
        events: record(replay.source),
        clock: replay.clock,
        awaitDecisions: true,
      };
    }
    // Each paced source counts from its own first item, so both timelines
    // are rebased to the earliest item of either before pacing.
    const [pacedTranscript, pacedPrices] = rebase([transcript, prices ?? []]);
    const events = merge(
      [
        paced(pacedTranscript ?? []),
        prices ? paced(pacedPrices ?? []) : ticks(),
        heartbeat,
      ],
      { primary: 0 }
    );
    if (originMs === undefined)
      return {
        events: record(events),
        clock: undefined,
        awaitDecisions: false,
      };
    // With a known audio start the clock runs at real speed from the
    // recording's own time, as the fast clock does, so the ledger's times
    // line up with the recorded ticks.
    const earliest = Math.min(0, transcript[0]?.at ?? 0, prices?.[0]?.at ?? 0);
    let startedAt: number | undefined;
    return {
      events: record((signal) => {
        startedAt = Date.now();
        return events(signal);
      }),
      clock: () =>
        originMs + earliest + (Date.now() - (startedAt ?? Date.now())),
      awaitDecisions: false,
    };
  }

  /**
   * For `--tee`: writes the replay's sidecar with the audio start it uses,
   * then returns a wrapper recording every segment and tick passed on.
   */
  private async tee(
    files: Paths,
    sidecar: Sidecar | undefined,
    audioStart: string | undefined
  ): Promise<(events: Source<EngineEvent>) => Source<EngineEvent>> {
    const teePath = files.tee ?? "";
    // Opened first: they create the directories the sidecar goes in.
    const lines = await JsonlWriter.open(teePath);
    const ticks = await JsonlWriter.open(files.ticks ?? "");
    if (sidecar)
      await writeSidecar(sidecarPath(teePath), {
        video: sidecar.video,
        transcribedAt: new Date().toISOString(),
        ...(audioStart === undefined ? {} : { audioStart }),
      });
    this.logger.info("writing transcript and ticks", {
      out: teePath,
      ticks: files.ticks,
    });
    return (events) =>
      async function* (signal) {
        try {
          for await (const event of events(signal)) {
            if (event.kind === "segment") await lines.append(event.segment);
            else if (event.kind === "tick") await ticks.append(event.tick);
            yield event;
          }
        } finally {
          await lines.close();
          await ticks.close();
        }
      };
  }
}
