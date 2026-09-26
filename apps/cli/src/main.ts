// Process entry point: reads argv, prints the result, and sets the exit code.
import { run, usage } from "./cli.ts";

try {
  console.log(run(process.argv.slice(2)));
} catch (error) {
  console.error(
    `${error instanceof Error ? error.message : String(error)}\n\n${usage}`
  );
  process.exitCode = 1;
}
