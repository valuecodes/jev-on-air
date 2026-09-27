// Turns a ledger and a transcript into one run's timeline. Pure, so the
// browser and the tests share it.
//
// A ledger file holds every run for a video, told apart by `run`. The
// transcript file is appended by each live run too, but its lines carry only
// audio time, which restarts at zero every session. So a run desk started is
// matched exactly by the byte offsets it recorded; any other run is matched
// by order to a transcript session, which is only approximate.
import type {
  EndEvent,
  JevEvent,
  SnapshotEvent,
  StartEvent,
} from "@repo/jev/ledger";

import type { LedgerLine, RunSummary, Segment, TranscriptLine } from "./types";

export type RunGroup = {
  run: string;
  start: StartEvent | undefined;
  events: JevEvent[];
  /** Offset of the group's first ledger line's end. */
  firstOffset: number;
};

/** Groups ledger lines by run, in order of first appearance. */
export function groupRuns(lines: LedgerLine[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();
  for (const { offset, event } of lines) {
    let group = groups.get(event.run);
    if (!group) {
      group = {
        run: event.run,
        start: undefined,
        events: [],
        firstOffset: offset,
      };
      groups.set(event.run, group);
    }
    if (event.type === "start") group.start = event;
    group.events.push(event);
  }
  return [...groups.values()];
}

const isLive = (group: RunGroup): boolean =>
  group.start?.source.startsWith("youtube:") ?? false;

/**
 * Splits a transcript into sessions: a new one begins wherever audio time
 * jumps back, because each transcriber process counts from zero.
 */
export function transcriptSessions(
  lines: TranscriptLine[]
): TranscriptLine[][] {
  const sessions: TranscriptLine[][] = [];
  let previous: Segment | undefined;
  for (const line of lines) {
    if (!previous || line.segment.start < previous.start - 1) sessions.push([]);
    sessions.at(-1)?.push(line);
    previous = line.segment;
  }
  return sessions;
}

export type RunTranscript = {
  lines: TranscriptLine[];
  match: "exact" | "approximate" | "none";
};

/** The transcript lines that belong to `groups[index]`. */
export function transcriptForRun(
  groups: RunGroup[],
  index: number,
  transcript: TranscriptLine[],
  deskRun: RunSummary | null
): RunTranscript {
  const group = groups[index];
  if (!group || !isLive(group)) return { lines: [], match: "none" };

  // Desk's run is the first group written after the ledger size it recorded.
  if (
    deskRun &&
    groups.find((candidate) => candidate.firstOffset > deskRun.ledgerStart) ===
      group
  ) {
    const after = transcript.filter(
      (line) => line.offset > deskRun.transcriptStart
    );
    return { lines: transcriptSessions(after)[0] ?? [], match: "exact" };
  }

  // Otherwise pair live runs and sessions from the newest back.
  const live = groups.filter(isLive);
  const sessions = transcriptSessions(transcript);
  const fromEnd = live.length - 1 - live.indexOf(group);
  const session = sessions[sessions.length - 1 - fromEnd];
  return session
    ? { lines: session, match: "approximate" }
    : { lines: [], match: "none" };
}

export type TimelineItem =
  | { kind: "segment"; key: string; segment: Segment }
  | { kind: "event"; key: string; event: JevEvent };

/**
 * Interleaves segments and events by audio time: an event follows the
 * transcript it had consumed. Segments no turn has consumed yet come last.
 */
export function buildTimeline(
  events: JevEvent[],
  lines: TranscriptLine[]
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let next = 0;
  const flush = (until: number): void => {
    while (next < lines.length) {
      const line = lines[next];
      if (!line || line.segment.end > until) break;
      items.push({
        kind: "segment",
        key: `s${line.offset}`,
        segment: line.segment,
      });
      next++;
    }
  };
  events.forEach((event, index) => {
    if (event.audioTime !== null) flush(event.audioTime + 0.001);
    items.push({ kind: "event", key: `e${index}`, event });
  });
  flush(Infinity);
  return items;
}

export type Book = SnapshotEvent | EndEvent;

/** The run's latest mark-to-market, if any. */
export function latestBook(events: JevEvent[]): Book | undefined {
  return events.findLast(
    (event): event is Book => event.type === "snapshot" || event.type === "end"
  );
}

/** Equity over the run: the start, every snapshot and the end. */
export function equityCurve(events: JevEvent[]): number[] {
  return events.flatMap((event) =>
    event.type === "start" || event.type === "snapshot" || event.type === "end"
      ? [event.equity]
      : []
  );
}
