// Where a `jev` run reads and writes: its ledger, portfolio state, the
// recordings it replays and the copies it tees.
import { join, resolve } from "node:path";

import type { JevArgs } from "./jev-args";

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

/** A live run keeps one book; a replay gets a scratch one per recording. */
const defaultState = (jevDir: string, args: JevArgs): string =>
  args.source.kind === "live"
    ? join(jevDir, "portfolio.json")
    : join(jevDir, "replay", `${args.id}.state.json`);

const paths = (args: JevArgs): Paths => {
  // `pnpm cli` runs from apps/cli; INIT_CWD is where the user typed it.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const jevDir = join(cacheDir, "jev");
  const result: Paths = {
    ledger:
      args.out === undefined
        ? join(jevDir, `${args.id}.jsonl`)
        : resolve(cwd, args.out),
    state:
      args.state === undefined
        ? defaultState(jevDir, args)
        : resolve(cwd, args.state),
  };
  if (args.source.kind === "replay") {
    result.transcript = resolve(cwd, args.source.transcript);
    if (args.source.prices !== undefined) {
      result.prices = resolve(cwd, args.source.prices);
    }
    if (args.source.tee) {
      result.tee = join(cacheDir, "transcripts", `${args.id}.jsonl`);
      result.ticks = join(cacheDir, "prices", `${args.id}.jsonl`);
    }
  } else {
    result.tee = join(cacheDir, "transcripts", `${args.source.videoId}.jsonl`);
    result.ticks = join(cacheDir, "prices", `${args.source.videoId}.jsonl`);
  }
  if (args.decider.kind === "script") {
    result.script = resolve(cwd, args.decider.path);
  }

  const seen = new Map<string, string>();
  for (const [name, path] of Object.entries(result)) {
    const other = seen.get(path);
    if (other !== undefined) {
      throw new Error(`${name} and ${other} are the same file: ${path}`);
    }
    seen.set(path, name);
  }
  return result;
};

export { paths };
export type { Paths };
