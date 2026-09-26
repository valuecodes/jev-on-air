// Process entry point: reads argv, prints the result, and sets the exit code.
import { Logger } from "@repo/logger";

import { parseTranscribeArgs, run, usage } from "./cli.ts";
import { TranscribeCommand } from "./transcribe.ts";

const argv = process.argv.slice(2);

function fail(error: unknown): void {
  console.error(
    `${error instanceof Error ? error.message : String(error)}\n\n${usage}`
  );
  process.exitCode = 1;
}

if (argv[0] === "transcribe") {
  let args;
  try {
    args = parseTranscribeArgs(argv.slice(1));
  } catch (error) {
    fail(error);
  }
  if (args) {
    // stdout carries the transcript, so logs go to stderr.
    const logger = new Logger({
      bindings: { service: "cli" },
      destination: process.stderr,
    });
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    try {
      await new TranscribeCommand(logger).run(args, controller.signal);
    } catch (error) {
      logger.error("transcription failed", { err: error });
      process.exitCode = 1;
    }
  }
} else {
  try {
    console.log(run(argv));
  } catch (error) {
    fail(error);
  }
}
