// POST: stop the active run.
import { guard } from "../../../../lib/guard";
import { runs } from "../../../../lib/runs";

export const dynamic = "force-dynamic";

export function POST(request: Request): Response {
  const refused = guard(request, { mutating: true });
  if (refused) return refused;
  const run = runs().stop();
  return run
    ? Response.json(run, { status: 202 })
    : Response.json({ error: "no run is active" }, { status: 404 });
}
