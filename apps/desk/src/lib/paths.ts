// Where the CLI keeps its files. Desk only reads them (and starts the CLI,
// which writes them), so these are fixed to the CLI's own cache.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The nearest directory at or above `start` holding `pnpm-workspace.yaml`. */
export function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error(`no pnpm-workspace.yaml above ${start}`);
    dir = parent;
  }
}

// `pnpm desk` runs Next from apps/desk, so the repo is found from there.
const repoRoot = findRepoRoot(process.cwd());

export const cliDir = join(repoRoot, "apps", "cli");
export const ledgerDir = join(cliDir, ".cache", "jev");
export const transcriptDir = join(cliDir, ".cache", "transcripts");
export const pricesDir = join(cliDir, ".cache", "prices");

/**
 * A ledger's name: the video id for live runs, the transcript's stem for
 * replays. No dots or slashes, so a name can never leave its directory.
 */
const ledgerIdPattern = /^[\w-]{1,64}$/;

export function isLedgerId(value: string): boolean {
  return ledgerIdPattern.test(value);
}

export const ledgerPath = (id: string): string =>
  join(ledgerDir, `${id}.jsonl`);
export const transcriptPath = (id: string): string =>
  join(transcriptDir, `${id}.jsonl`);
export const metaPath = (id: string): string =>
  join(transcriptDir, `${id}.meta.json`);
export const ticksPath = (id: string): string => join(pricesDir, `${id}.jsonl`);
