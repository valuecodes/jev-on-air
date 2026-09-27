import { describe, expect, it } from "vitest";

import { childEnv, isZonedTime, parseTime } from "./time";

describe("parseTime", () => {
  it("normalises zoned times and rejects the rest", () => {
    expect(parseTime("from", "2026-09-16T20:25:00+02:00")).toBe(
      "2026-09-16T18:25:00.000Z"
    );
    expect(parseTime("from", "2026-09-16T18:25Z")).toBe(
      "2026-09-16T18:25:00.000Z"
    );
    expect(() => parseTime("from", "2026-09-16T18:25:00")).toThrow(
      /--from must be an RFC 3339 time with a zone/
    );
    expect(() => parseTime("from", "2026-13-40T18:25:00Z")).toThrow(/--from/);
    expect(isZonedTime("yesterday")).toBe(false);
  });
});

describe("childEnv", () => {
  it("drops anything that looks like a credential", () => {
    expect(
      childEnv({
        PATH: "/bin",
        HOME: "/home/x",
        ALPACA_API_KEY_ID: "id",
        ALPACA_API_SECRET_KEY: "s",
        TYPESAFE_API_KEY: "k",
        GITHUB_TOKEN: "t",
        DB_PASSWORD: "p",
        AWS_CREDENTIAL_FILE: "f",
      })
    ).toEqual({ PATH: "/bin", HOME: "/home/x" });
  });
});
