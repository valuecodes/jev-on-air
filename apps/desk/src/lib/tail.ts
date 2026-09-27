// Follows a JSON-lines file as the CLI appends to it: reads from a byte
// offset, hands over complete lines only, and starts over if the file is
// replaced or truncated. It never writes, so it cannot slow a run down.
import { watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";

export type TailLine = {
  text: string;
  /** Byte offset just past the line's newline: where the next line starts. */
  end: number;
};

const NEWLINE = 0x0a;
const MAX_READ = 1 << 20;

/**
 * Splits `pending + chunk` at newlines. `base` is the file offset where
 * `pending` begins. Bytes after the last newline come back as `rest`, so a
 * line (or a UTF-8 character) cut by a read is only decoded once complete.
 * Blank lines are dropped but still move the offset.
 */
export function splitLines(
  pending: Buffer,
  chunk: Buffer,
  base: number
): { lines: TailLine[]; rest: Buffer } {
  const buffer = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  const lines: TailLine[] = [];
  let start = 0;
  for (
    let index = buffer.indexOf(NEWLINE);
    index !== -1;
    index = buffer.indexOf(NEWLINE, start)
  ) {
    const text = buffer.toString("utf8", start, index).replace(/\r$/, "");
    if (text.trim() !== "") lines.push({ text, end: base + index + 1 });
    start = index + 1;
  }
  return { lines, rest: Buffer.from(buffer.subarray(start)) };
}

export type TailerOptions = {
  /** Offset to resume from; must be a line boundary (a `TailLine.end`). */
  from?: number;
  onLines: (lines: TailLine[]) => void;
  /** The file was replaced or truncated; reading restarts at offset 0. */
  onReset?: () => void;
  onError?: (error: unknown) => void;
  /** Safety-net poll for missed or unsupported watch events (default 1000). */
  pollMs?: number;
};

export class FileTailer {
  private readonly path: string;
  private readonly options: TailerOptions;
  /** Bytes read so far, including `pending`. */
  private readFrom: number;
  private pending: Buffer = Buffer.alloc(0);
  /**
   * Inode plus birth time: a recreated file can reuse the inode. Birth time
   * is coarse on some filesystems (~4 ms on WSL2), so a file replaced within
   * one tick by one at least as long goes unnoticed; the CLI only appends.
   */
  private identity: string | undefined;
  private chain: Promise<void> = Promise.resolve();
  private watcher: FSWatcher | undefined;
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(path: string, options: TailerOptions) {
    this.path = path;
    this.options = options;
    this.readFrom = options.from ?? 0;
  }

  /**
   * Watches the directory (so a file that does not exist yet, or is
   * replaced, is still picked up) before the first read, so nothing appended
   * in between is missed: every event just triggers another offset read.
   */
  start(): void {
    try {
      this.watcher = watch(dirname(this.path), (_event, name) => {
        if (name === null || name === basename(this.path)) void this.sync();
      });
      this.watcher.on("error", () => this.watcher?.close());
    } catch {
      // The directory does not exist yet; the poll below covers it.
    }
    this.timer = setInterval(
      () => void this.sync(),
      this.options.pollMs ?? 1000
    );
    void this.sync();
  }

  stop(): void {
    this.closed = true;
    this.watcher?.close();
    clearInterval(this.timer);
  }

  /** Reads whatever was appended since the last read. Calls never overlap. */
  sync(): Promise<void> {
    this.chain = this.chain
      .then(() => this.read())
      .catch((error: unknown) => this.options.onError?.(error));
    return this.chain;
  }

  private reset(): void {
    this.readFrom = 0;
    this.pending = Buffer.alloc(0);
    this.options.onReset?.();
  }

  private async read(): Promise<void> {
    if (this.closed) return;
    let info;
    try {
      info = await stat(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Deleted after being read: whatever replaces it starts from zero.
      if (this.identity !== undefined) {
        this.identity = undefined;
        this.reset();
      }
      return;
    }
    const identity = `${info.ino}:${info.birthtimeMs}`;
    if (
      (this.identity !== undefined && identity !== this.identity) ||
      info.size < this.readFrom
    )
      this.reset();
    this.identity = identity;
    if (info.size <= this.readFrom) return;

    const handle = await open(this.path, "r");
    try {
      const buffer = Buffer.alloc(
        Math.min(info.size - this.readFrom, MAX_READ)
      );
      while (!this.closed && this.readFrom < info.size) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, info.size - this.readFrom),
          this.readFrom
        );
        if (bytesRead === 0) break;
        const { lines, rest } = splitLines(
          this.pending,
          buffer.subarray(0, bytesRead),
          this.readFrom - this.pending.length
        );
        this.pending = rest;
        this.readFrom += bytesRead;
        if (lines.length) this.options.onLines(lines);
      }
    } finally {
      await handle.close();
    }
  }
}
