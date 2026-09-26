// Process entry point: reads argv, prints the result, and sets the exit code.
import { Logger } from "@repo/logger";

import { parseTranscribeArgs, run, usage } from "./cli";
import { TranscribeCommand } from "./transcribe";

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
    // later one exits at once, and the transcriber's exit hook kills them.
    // A terminal Ctrl+C arrives twice — directly and relayed by tsx — so
    // signals within a second of the first count as the same one.
    const controller = new AbortController();
    let abortedAt = 0;
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.on(name, () => {
        if (!controller.signal.aborted) {
          abortedAt = Date.now();
          controller.abort();
        } else if (Date.now() - abortedAt > 1000) {
          process.exit(130);
        }
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
