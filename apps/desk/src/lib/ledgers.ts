// The ledgers the CLI has written, newest first, with the video's title from
// the transcript's `.meta.json` when there is one.
import { open, readdir, readFile, stat } from "node:fs/promises";

import { isLedgerId, ledgerDir, ledgerPath, metaPath } from "./paths";
import type { LedgerInfo } from "./types";

/** A run snapshots every minute, so a quiet file this old has stopped. */
const LIVE_WINDOW_MS = 3 * 60_000;
const TAIL_BYTES = 64 * 1024;

/** The `type` of the last complete line in a file, if it parses. */
async function lastEventType(
  path: string,
  size: number
): Promise<string | undefined> {
  const handle = await open(path, "r");
  try {
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const lines = buffer.toString("utf8").trimEnd().split("\n");
    const parsed: unknown = JSON.parse(lines.at(-1) ?? "");
    return typeof parsed === "object" && parsed !== null && "type" in parsed
      ? String(parsed.type)
      : undefined;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

async function readMeta(
  id: string
): Promise<{ title: string | null; channel: string | null }> {
  try {
    const meta = JSON.parse(await readFile(metaPath(id), "utf8")) as {
      video?: { title?: unknown; channel?: unknown };
    };
    return {
      title: typeof meta.video?.title === "string" ? meta.video.title : null,
      channel:
        typeof meta.video?.channel === "string" ? meta.video.channel : null,
    };
  } catch {
    return { title: null, channel: null };
  }
}

export async function listLedgers(now = Date.now()): Promise<LedgerInfo[]> {
  let names: string[];
  try {
    names = await readdir(ledgerDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const ids = names
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.slice(0, -".jsonl".length))
    .filter(isLedgerId);

  const ledgers = await Promise.all(
    ids.map(async (id): Promise<LedgerInfo | undefined> => {
      try {
        const path = ledgerPath(id);
        const info = await stat(path);
        const recent = now - info.mtimeMs < LIVE_WINDOW_MS;
        const live = recent && (await lastEventType(path, info.size)) !== "end";
        return {
          id,
          ...(await readMeta(id)),
          updatedAt: info.mtime.toISOString(),
          live,
        };
      } catch {
        return undefined;
      }
    })
  );
  return ledgers
    .filter((ledger) => ledger !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
