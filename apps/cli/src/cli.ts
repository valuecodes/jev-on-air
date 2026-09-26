// Argument parsing and commands. Pure: returns the output instead of printing it,
// so tests can call `run` directly. `main.ts` is the process entry point.
import { parseArgs } from "node:util";

export const usage = `Usage: pnpm cli [options]

Options:
  --hello-world    Print a greeting
  --name=<name>    Who to greet with --hello-world (default: world)
  -h, --help       Show this message`;

/** Parses `argv` and returns the text to print. Throws on unknown flags. */
export function run(argv: string[]): string {
  const { values } = parseArgs({
    args: argv,
    options: {
      "hello-world": { type: "boolean" },
      name: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values["hello-world"]) return `Hello, ${values.name ?? "world"}!`;
  return usage;
}
