// The portfolio on disk: one JSON file holding cash, realised P&L and the open
// positions, so a book survives restarts and carries across streams. Saves go
// through a temporary file and a rename, so a crash never leaves half a file.
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

import { INSTRUMENT_IDS } from "./schema";

const finite = z.number().finite();
const positive = finite.positive();

export const PositionSchema = z.object({
  side: z.enum(["long", "short"]),
  quantity: positive,
  avgPrice: positive,
});

export const PortfolioStateSchema = z.object({
  version: z.literal(1),
  cash: finite,
  realized: finite,
  positions: z.partialRecord(z.enum(INSTRUMENT_IDS), PositionSchema),
  /** ISO time of the last save. */
  updatedAt: z.string(),
  /** Id of the run that last saved, when known. */
  lastRun: z.string().optional(),
});

export type PortfolioState = z.infer<typeof PortfolioStateSchema>;

/** Throws, naming the problem, if `value` is not a saved portfolio. */
export function parsePortfolioState(value: unknown): PortfolioState {
  const result = PortfolioStateSchema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
  throw new Error(`${issue?.message ?? "invalid"}${where}`);
}

export class StateFile {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** The saved state, or `undefined` when there is no file yet. */
  async load(): Promise<PortfolioState | undefined> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new Error(`invalid state file ${this.path}: not JSON`, {
        cause: error,
      });
    }
    try {
      return parsePortfolioState(value);
    } catch (error) {
      throw new Error(
        `invalid state file ${this.path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async save(state: PortfolioState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, this.path);
  }

  /**
   * Claims the file for this process, so two runs cannot save over each
   * other. Throws if a live process holds it; a lock left by a dead one is
   * taken over. Resolves to the function that releases it.
   */
  async lock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    // The pid is written to a private file first and linked into place, so
    // the lock never exists without its owner's pid inside it.
    const temporary = `${lockPath}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      `${process.pid}
`
    );
    try {
      for (;;) {
        try {
          await link(temporary, lockPath);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const holder = await readFile(lockPath, "utf8").catch(() => "");
          const pid = Number(holder.trim());
          if (Number.isInteger(pid) && pid > 0 && isRunning(pid))
            throw new Error(
              `${this.path} is in use by another run (pid ${pid}); pass --state to use a separate portfolio`
            );
          await rm(lockPath, { force: true });
        }
      }
    } finally {
      await rm(temporary, { force: true });
    }
    return async () => {
      await rm(lockPath, { force: true });
    };
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just is not ours.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
