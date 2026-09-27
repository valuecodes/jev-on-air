import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildSidecar,
  readSidecar,
  sidecarPath,
  writeSidecar,
} from "./sidecar";

const archive = {
  id: "H8FlQPYHGA4",
  title: "Site Visit",
  live: "was_live" as const,
  startedAt: "2026-09-25T15:43:13.000Z",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "jev-sidecar-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("sidecarPath", () => {
  it("sits next to the transcript", () => {
    expect(sidecarPath("/x/abc.jsonl")).toBe("/x/abc.meta.json");
    expect(sidecarPath("/x/abc")).toBe("/x/abc.meta.json");
  });
});

describe("buildSidecar", () => {
  it("takes the audio start from the broadcast, the transcription, or nowhere", () => {
    const at = "2026-09-27T06:00:00.000Z";
    expect(buildSidecar(archive, at)).toEqual({
      video: archive,
      transcribedAt: at,
      audioStart: archive.startedAt,
    });
    expect(buildSidecar({ ...archive, live: "is_live" }, at).audioStart).toBe(
      at
    );
    expect(
      buildSidecar({ id: "x", title: "Upload", live: "not_live" }, at)
        .audioStart
    ).toBeUndefined();
  });
});

describe("readSidecar", () => {
  it("round-trips, reports a missing file as undefined and rejects junk", async () => {
    const path = join(dir, "abc.meta.json");
    expect(await readSidecar(path)).toBeUndefined();
    const sidecar = buildSidecar(archive, "2026-09-27T06:00:00.000Z");
    await writeSidecar(path, sidecar);
    expect(await readSidecar(path)).toEqual(sidecar);
    await writeFile(path, JSON.stringify({ video: archive }));
    await expect(readSidecar(path)).rejects.toThrow(/not a transcript sidecar/);
    await writeFile(path, JSON.stringify({ video: null, transcribedAt: "t" }));
    await expect(readSidecar(path)).rejects.toThrow(/not a transcript sidecar/);
    await writeFile(path, JSON.stringify({ ...sidecar, audioStart: "soon" }));
    await expect(readSidecar(path)).rejects.toThrow(/not a transcript sidecar/);
  });
});
