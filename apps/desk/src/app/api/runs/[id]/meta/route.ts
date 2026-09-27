// GET: the transcript's `.meta.json` for a ledger id — which video it is and
// when its audio began — or 404 if there is none.
import { readFile } from "node:fs/promises";

import { guard } from "../../../../../lib/guard";
import { isLedgerId, metaPath } from "../../../../../lib/paths";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const refused = guard(request, { mutating: false });
  if (refused) return refused;
  const { id } = await params;
  if (!isLedgerId(id))
    return Response.json({ error: "unknown ledger" }, { status: 404 });
  let text;
  try {
    text = await readFile(metaPath(id), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return Response.json({ error: "no metadata" }, { status: 404 });
    throw error;
  }
  try {
    return Response.json(JSON.parse(text) as unknown);
  } catch {
    return Response.json({ error: "unreadable metadata" }, { status: 500 });
  }
}
