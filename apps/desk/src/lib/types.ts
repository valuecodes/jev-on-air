// Shapes shared by the API routes and the browser. No Node imports here, so
// client components can use them.
import type { JevEvent } from "@repo/jev/ledger";

export type RunState =
  "starting" | "running" | "stopping" | "exited" | "failed";

/** A run desk started. Runs started elsewhere only exist as ledgers. */
export type RunSummary = {
  id: string;
  videoId: string;
  startedAt: string;
  state: RunState;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  /** Ledger and transcript sizes when the run started: where its lines begin. */
  ledgerStart: number;
  transcriptStart: number;
};

export type OutputLine = {
  /** The desk process's registry; `seq` counts from zero in each. */
  generation: number;
  seq: number;
  stream: "stdout" | "stderr";
  text: string;
};

export type LedgerInfo = {
  id: string;
  title: string | null;
  channel: string | null;
  updatedAt: string;
  /** The last event is not `end` and the file changed recently. */
  live: boolean;
};

export type Segment = { start: number; end: number; text: string };

export type LedgerLine = { offset: number; event: JevEvent };
export type TranscriptLine = { offset: number; segment: Segment };
