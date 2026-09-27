// JSON Lines files: the transcript and tick recordings a replay reads, and
// the ledger a run appends to.
import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

/** Yields the non-blank lines of `path`. */
export async function* readJsonl(path: string): AsyncGenerator<string> {
  const lines = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line.trim() !== "") yield line;
}

/** Parses every line of `path` with `parse`, naming the line on failure. */
export async function readJsonlAs<T>(
  path: string,
  parse: (line: string) => T
): Promise<T[]> {
  const values: T[] = [];
  let number = 0;
  for await (const line of readJsonl(path)) {
    number += 1;
    try {
      values.push(parse(line));
    } catch (error) {
      throw new Error(
        `${path}:${number}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }
  return values;
}

/** Appends JSON values to `path`, one per line, creating it if needed. */
export class JsonlWriter {
  private readonly file: Awaited<ReturnType<typeof open>>;

  private constructor(file: Awaited<ReturnType<typeof open>>) {
    this.file = file;
  }

  static async open(path: string): Promise<JsonlWriter> {
    await mkdir(dirname(path), { recursive: true });
    return new JsonlWriter(await open(path, "a"));
  }

  async append(value: unknown): Promise<void> {
    await this.file.appendFile(`${JSON.stringify(value)}\n`);
  }

  async close(): Promise<void> {
    await this.file.close();
  }
}
