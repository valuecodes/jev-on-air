// The stream's event id: how far into the ledger, the transcript and the run
// output a client has got, so a reconnecting EventSource resumes there.

export type Cursor = { ledger: number; transcript: number; output: number };

/** `ledger.transcript.output`; anything malformed counts as zero. */
export function parseCursor(value: string | null): Cursor {
  const [ledger, transcript, output] = (value ?? "")
    .split(".")
    .map((part) => (/^\d{1,15}$/.test(part) ? Number(part) : 0));
  return {
    ledger: ledger ?? 0,
    transcript: transcript ?? 0,
    output: output ?? 0,
  };
}

export const formatCursor = (cursor: Cursor): string =>
  `${cursor.ledger}.${cursor.transcript}.${cursor.output}`;
