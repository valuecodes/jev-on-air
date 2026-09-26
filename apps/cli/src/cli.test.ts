import { describe, expect, it } from "vitest";

import { run, usage } from "./cli.ts";

describe("run", () => {
  it("prints a greeting for --hello-world", () => {
    expect(run(["--hello-world"])).toBe("Hello, world!");
  });

  it("greets the given --name", () => {
    expect(run(["--hello-world", "--name=test"])).toBe("Hello, test!");
    expect(run(["--hello-world", "--name", "test"])).toBe("Hello, test!");
  });

  it("prints usage with no arguments", () => {
    expect(run([])).toBe(usage);
  });

  it("prints usage for --help and -h", () => {
    expect(run(["--help"])).toBe(usage);
    expect(run(["-h"])).toBe(usage);
  });

  it("throws on an unknown flag", () => {
    expect(() => run(["--nope"])).toThrow();
  });
});
