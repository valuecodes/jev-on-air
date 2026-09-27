import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePortfolioState, StateFile } from "./state";
import type { PortfolioState } from "./state";

const state: PortfolioState = {
  version: 1,
  cash: 90_000,
  realized: 12.5,
  positions: { gold: { side: "long", quantity: 50, avgPrice: 200 } },
  updatedAt: "2026-09-26T12:00:00.000Z",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jev-state-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("StateFile", () => {
  it("returns undefined without a file and round-trips a save", async () => {
    const file = new StateFile(join(dir, "nested", "portfolio.json"));
    expect(await file.load()).toBeUndefined();
    await file.save(state);
    expect(await file.load()).toEqual(state);
    expect(await readdir(join(dir, "nested"))).toEqual(["portfolio.json"]);
    expect(await readFile(file.path, "utf8")).toMatch(/\n$/);
  });

  it("rejects files that are not JSON or not a portfolio", async () => {
    const file = new StateFile(join(dir, "portfolio.json"));
    await writeFile(file.path, "{");
    await expect(file.load()).rejects.toThrow(
      /invalid state file .*: not JSON/
    );
    await writeFile(
      file.path,
      JSON.stringify({
        ...state,
        positions: { gold: { side: "long", quantity: -1, avgPrice: 200 } },
      })
    );
    await expect(file.load()).rejects.toThrow(
      /invalid state file .* at positions\.gold\.quantity/
    );
  });
});

describe("StateFile.lock", () => {
  it("refuses a file held by a live process and takes over a dead one's lock", async () => {
    const file = new StateFile(join(dir, "portfolio.json"));
    const unlock = await file.lock();
    expect(await readFile(`${file.path}.lock`, "utf8")).toBe(
      `${process.pid}\n`
    );
    await expect(file.lock()).rejects.toThrow(
      /in use by another run \(pid \d+\); pass --state/
    );
    expect(await readdir(dir)).toEqual(["portfolio.json.lock"]);
    await unlock();
    expect(await readdir(dir)).toEqual([]);

    // A pid that cannot exist: the lock is stale and gets replaced.
    await writeFile(`${file.path}.lock`, "2147483647\n");
    const again = await file.lock();
    expect(await readFile(`${file.path}.lock`, "utf8")).toBe(
      `${process.pid}\n`
    );
    await again();
  });
});

describe("parsePortfolioState", () => {
  it("names the first problem", () => {
    expect(() => parsePortfolioState({ ...state, version: 2 })).toThrow(
      /at version/
    );
    expect(() => parsePortfolioState({ ...state, cash: Infinity })).toThrow(
      /at cash/
    );
    expect(() =>
      parsePortfolioState({
        ...state,
        positions: { silver: { side: "long", quantity: 1, avgPrice: 1 } },
      })
    ).toThrow(/positions/);
    expect(parsePortfolioState({ ...state, lastRun: "r" })).toEqual({
      ...state,
      lastRun: "r",
    });
  });
});
