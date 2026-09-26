// Process entry point: reads argv, prints the result, and sets the exit code.
import { join } from "node:path";
import { Logger } from "@repo/logger";

import {
  alpacaCredentials,
  parsePricesArgs,
  parseTranscribeArgs,
  run,
  usage,
} from "./cli";
import { PricesCommand } from "./prices";
import { TranscribeCommand } from "./transcribe";

// Secrets such as the Alpaca keys may live in `.env` at the repo root. Values
// already in the environment win.
try {
  process.loadEnvFile(join(import.meta.dirname, "..", "..", "..", ".env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const argv = process.argv.slice(2);

function fail(error: unknown): void {
  console.error(
    `${error instanceof Error ? error.message : String(error)}\n\n${usage}`
  );
  process.exitCode = 1;
}

/**
 * Runs a long-lived command until it ends or the process is signalled. stdout
 * carries the command's output, so logs go to stderr.
 */
async function runStreaming(
  name: string,
  command: (logger: Logger, signal: AbortSignal) => Promise<void>
): Promise<void> {
  const logger = new Logger({
    bindings: { service: "cli" },
    destination: process.stderr,
  });
  // The first signal aborts, which lets the command shut down cleanly (the
  // transcriber's processes run in their own process groups, so they do not
  // see these signals); a later one exits at once, and the transcriber's exit
  // hook kills them. A terminal Ctrl+C arrives twice — directly and relayed by
  // tsx — so signals within a second of the first count as the same one.
  const controller = new AbortController();
  let abortedAt = 0;
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(signal, () => {
      if (!controller.signal.aborted) {
        abortedAt = Date.now();
        controller.abort();
      } else if (Date.now() - abortedAt > 1000) {
        process.exit(130);
      }
    });
  try {
    await command(logger, controller.signal);
  } catch (error) {
    logger.error(`${name} failed`, { err: error });
    process.exitCode = 1;
  }
}

if (argv[0] === "transcribe") {
  let args;
  try {
    args = parseTranscribeArgs(argv.slice(1));
  } catch (error) {
    fail(error);
  }
  if (args) {
    const transcribeArgs = args;
    await runStreaming("transcription", (logger, signal) =>
      new TranscribeCommand(logger).run(transcribeArgs, signal)
    );
  }
} else if (argv[0] === "prices") {
  let args;
  let credentials;
  try {
    args = parsePricesArgs(argv.slice(1));
    credentials = alpacaCredentials(process.env);
  } catch (error) {
    fail(error);
  }
  if (args && credentials) {
    const pricesArgs = args;
    const alpaca = credentials;
    await runStreaming("prices", (logger, signal) =>
      new PricesCommand(logger).run(pricesArgs, alpaca, signal)
    );
  }
} else {
  try {
    console.log(run(argv));
  } catch (error) {
    fail(error);
  }
}
