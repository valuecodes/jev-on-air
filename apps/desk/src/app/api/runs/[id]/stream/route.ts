// GET: server-sent events for one ledger id — its ledger lines, transcript
// lines, and the state and output of desk's run for it. Each event's id is a
// cursor over all three (lib/cursor.ts).
import { formatCursor, parseCursor } from "../../../../../lib/cursor";
import { guard } from "../../../../../lib/guard";
import {
  isLedgerId,
  ledgerPath,
  transcriptPath,
} from "../../../../../lib/paths";
import { runs } from "../../../../../lib/runs";
import { FileTailer } from "../../../../../lib/tail";
import type { TailLine } from "../../../../../lib/tail";

export const dynamic = "force-dynamic";

const PING_MS = 15_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const refused = guard(request, { mutating: false });
  if (refused) return refused;
  const { id } = await params;
  if (!isLedgerId(id))
    return Response.json({ error: "unknown ledger" }, { status: 404 });

  const cursor = parseCursor(request.headers.get("last-event-id"));
  const encoder = new TextEncoder();
  let cleanup = (): void => undefined;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string): void => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };
      const send = (event: string, data: unknown): void =>
        write(
          `id: ${formatCursor(cursor)}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        );

      const follow = (
        file: "ledger" | "transcript",
        path: string
      ): FileTailer =>
        new FileTailer(path, {
          from: cursor[file],
          onLines: (lines: TailLine[]) => {
            for (const line of lines) {
              cursor[file] = line.end;
              let value: unknown;
              try {
                value = JSON.parse(line.text);
              } catch {
                send("invalid", { file, offset: line.end });
                continue;
              }
              send(file, { offset: line.end, value });
            }
          },
          onReset: () => {
            cursor[file] = 0;
            send("reset", { file });
          },
          onError: (error) =>
            send("notice", {
              message: `${file}: ${error instanceof Error ? error.message : String(error)}`,
            }),
        });

      const ledger = follow("ledger", ledgerPath(id));
      const transcript = follow("transcript", transcriptPath(id));
      const unsubscribe = runs().subscribe(id, cursor.output, (event) => {
        if (event.kind === "output") {
          cursor.output = event.line.seq;
          send("output", event.line);
        } else {
          send("state", event.run);
        }
      });
      const ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ledger.start();
      transcript.start();

      cleanup = () => {
        if (closed) return;
        closed = true;
        ledger.stop();
        transcript.stop();
        unsubscribe();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
