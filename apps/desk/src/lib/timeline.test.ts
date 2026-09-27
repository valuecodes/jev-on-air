import type { JevEvent } from "@repo/jev/ledger";
import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  equityCurve,
  groupRuns,
  transcriptForRun,
  transcriptSessions,
} from "./timeline";
import type { LedgerLine, RunSummary, TranscriptLine } from "./types";

const base = { audioTime: null, turn: null, time: "2026-09-27T07:00:00.000Z" };

function start(run: string, source = "youtube:5vfaDsMhCF4"): JevEvent {
  return {
    ...base,
    run,
    type: "start",
    source,
    model: "m",
    cash: 100,
    equity: 100,
    size: 0.1,
    resumed: false,
  };
}

function decision(run: string, audioTime: number): JevEvent {
  return {
    ...base,
    run,
    audioTime,
    turn: 1,
    type: "decision",
    decisions: [],
    signal: 0.1,
    model: "m",
    latencyMs: 1,
    segments: 1,
    usage: null,
  };
}

const ledger = (events: JevEvent[]): LedgerLine[] =>
  events.map((event, index) => ({ offset: (index + 1) * 10, event }));

const transcript = (starts: number[]): TranscriptLine[] =>
  starts.map((at, index) => ({
    offset: (index + 1) * 10,
    segment: { start: at, end: at + 1, text: `t${at}` },
  }));

const deskRun = (ledgerStart: number, transcriptStart: number): RunSummary => ({
  id: "x",
  videoId: "5vfaDsMhCF4",
  startedAt: "",
  state: "running",
  exitCode: null,
  signal: null,
  error: null,
  mode: "live",
  ledgerStart,
  transcriptStart,
});

describe("groupRuns", () => {
  it("groups by run in order of first appearance", () => {
    const groups = groupRuns(
      ledger([start("a"), decision("a", 1), start("b")])
    );
    expect(
      groups.map((group) => [group.run, group.events.length, group.firstOffset])
    ).toEqual([
      ["a", 2, 10],
      ["b", 1, 30],
    ]);
  });
});

describe("transcriptSessions", () => {
  it("starts a session wherever audio time jumps back", () => {
    const sessions = transcriptSessions(transcript([0, 5, 10, 0, 4, 3.5, 0]));
    expect(
      sessions.map((session) => session.map((line) => line.segment.start))
    ).toEqual([[0, 5, 10], [0, 4, 3.5], [0]]);
  });
});

describe("transcriptForRun", () => {
  const groups = groupRuns(ledger([start("a"), start("b")]));
  const lines = transcript([0, 5, 0, 5]);

  it("uses desk's recorded offsets for the run it started", () => {
    const result = transcriptForRun(groups, 1, lines, deskRun(15, 20));
    expect(result.match).toBe("exact");
    expect(result.lines.map((line) => line.offset)).toEqual([30, 40]);
  });

  it("pairs other live runs with sessions from the newest back", () => {
    expect(transcriptForRun(groups, 0, lines, null)).toMatchObject({
      match: "approximate",
    });
    expect(
      transcriptForRun(groups, 0, lines, null).lines.map((line) => line.offset)
    ).toEqual([10, 20]);
  });

  it("gives replays no transcript unless desk started them", () => {
    const replay = groupRuns(
      ledger([start("r", "replay:x.jsonl"), start("s", "replay:x.jsonl")])
    );
    expect(transcriptForRun(replay, 0, lines, null)).toEqual({
      lines: [],
      match: "none",
    });
    // Desk's replays tee what they replay, recorded from its offsets.
    const result = transcriptForRun(replay, 1, lines, deskRun(15, 20));
    expect(result.match).toBe("exact");
    expect(result.lines.map((line) => line.offset)).toEqual([30, 40]);
    expect(transcriptForRun(replay, 0, lines, deskRun(15, 20))).toEqual({
      lines: [],
      match: "none",
    });
  });
});

describe("buildTimeline", () => {
  it("puts each event after the transcript it consumed and the rest last", () => {
    const items = buildTimeline(
      [start("a"), decision("a", 6)],
      transcript([0, 5, 10])
    );
    expect(
      items.map((item) =>
        item.kind === "segment" ? item.segment.text : item.event.type
      )
    ).toEqual(["start", "t0", "t5", "decision", "t10"]);
  });
});

describe("equityCurve", () => {
  it("takes equity from start, snapshots and end", () => {
    expect(equityCurve([start("a"), decision("a", 1)])).toEqual([100]);
  });
});
