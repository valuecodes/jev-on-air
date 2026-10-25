// POST { id }: stop the active run, if it is the one the page shows.
import { z } from "zod";

import { guard } from "~/lib/guard";
import { RunConflictError, runs } from "~/lib/runs";

const StopRequestSchema = z.strictObject({ id: z.string().min(1).max(100) });

const POST = async (request: Request): Promise<Response> => {
  const refused = guard(request, { mutating: true });
  if (refused) {
    return refused;
  }
  let id;
  try {
    ({ id } = StopRequestSchema.parse(await request.json()));
  } catch {
    return Response.json({ error: "expected { id }" }, { status: 400 });
  }
  try {
    const run = runs().stop(id);
    return run
      ? Response.json(run, { status: 202 })
      : Response.json({ error: "no run is active" }, { status: 404 });
  } catch (error) {
    if (error instanceof RunConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
};

// Next reads route segment config only from an inline `export const`.
export const dynamic = "force-dynamic";
export { POST };
