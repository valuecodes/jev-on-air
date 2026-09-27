// The stream's event id: how far into the ledger, the transcript, the tick
// file and the run output a client has got, so a reconnecting EventSource
// resumes there. Run output is counted per desk process, so its position
// carries the registry's generation too.

export type Cursor = {
  ledger: number;
  transcript: number;
  ticks: number;
  generation: number;
  output: number;
};

/**
 * `ledger.transcript.ticks.generation.output`; anything malformed counts as
 * zero.
 */
export function parseCursor(value: string | null): Cursor {
  const [ledger, transcript, ticks, generation, output] = (value ?? "")
    .split(".")
    .map((part) => (/^\d{1,15}$/.test(part) ? Number(part) : 0));
  return {
    ledger: ledger ?? 0,
    transcript: transcript ?? 0,
    ticks: ticks ?? 0,
    generation: generation ?? 0,
    output: output ?? 0,
  };
}

export const formatCursor = (cursor: Cursor): string =>
  [
    cursor.ledger,
    cursor.transcript,
    cursor.ticks,
    cursor.generation,
    cursor.output,
  ].join(".");
