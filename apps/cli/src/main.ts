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
    // The transcriber's processes run in their own process groups, so they
    // do not see these signals. The first one aborts, which stops them; a
    // second exits at once, and the transcriber's exit hook kills them.
    const controller = new AbortController();
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.on(name, () => {
        if (controller.signal.aborted) process.exit(130);
        controller.abort();
      });
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
