// Where the CLI keeps its files. Desk only reads them (and starts the CLI,
// which writes them), so these are fixed to the CLI's own cache.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The nearest directory at or above `start` holding `pnpm-workspace.yaml`. */
const findRepoRoot = (start: string): string => {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`no pnpm-workspace.yaml above ${start}`);
    }
    dir = parent;
  }
};

// `pnpm desk` runs Next from apps/desk, so the repo is found from there.
const repoRoot = findRepoRoot(process.cwd());

const cliDir = join(repoRoot, "apps", "cli");
const ledgerDir = join(cliDir, ".cache", "jev");
const transcriptDir = join(cliDir, ".cache", "transcripts");
const pricesDir = join(cliDir, ".cache", "prices");

/**
 * A ledger's name: the video id for live runs, the transcript's stem for
 * replays. No dots or slashes, so a name can never leave its directory.
 */
const ledgerIdPattern = /^[\w-]{1,64}$/;

const isLedgerId = (value: string): boolean => ledgerIdPattern.test(value);

const ledgerPath = (id: string): string => join(ledgerDir, `${id}.jsonl`);
const transcriptPath = (id: string): string =>
  join(transcriptDir, `${id}.jsonl`);
const metaPath = (id: string): string => join(transcriptDir, `${id}.meta.json`);
const ticksPath = (id: string): string => join(pricesDir, `${id}.jsonl`);

export {
  cliDir,
  isLedgerId,
  ledgerDir,
  ledgerPath,
  metaPath,
  ticksPath,
  transcriptPath,
};
