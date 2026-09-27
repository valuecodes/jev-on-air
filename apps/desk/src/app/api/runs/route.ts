// GET: past ledgers and desk's runs. POST: start a run.
import { guard } from "../../../lib/guard";
import { listLedgers } from "../../../lib/ledgers";
import { RunConflictError, runs } from "../../../lib/runs";
import { parseStartRequest } from "../../../lib/start";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = guard(request, { mutating: false });
  if (refused) return refused;
  return Response.json({ runs: runs().list(), ledgers: await listLedgers() });
}

export async function POST(request: Request): Promise<Response> {
  const refused = guard(request, { mutating: true });
  if (refused) return refused;
  let start;
  try {
    start = parseStartRequest(await request.json());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }
  try {
    return Response.json(await runs().start(start), { status: 201 });
  } catch (error) {
    if (error instanceof RunConflictError)
      return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
