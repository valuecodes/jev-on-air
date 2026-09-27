// Desk can start processes that spend API credits and trade the shared paper
// portfolio, so every route checks where a request comes from. Binding to
// 127.0.0.1 keeps other machines out; these checks keep other *websites* out:
// the Host check defeats DNS rebinding, and Origin + a JSON content type
// block cross-site form posts and simple fetches.

const localHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostname(host: string): string | undefined {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return undefined;
  }
}

/** Why a request is refused, or `undefined` if it may proceed. */
export function refusal(
  headers: Headers,
  { mutating }: { mutating: boolean }
): string | undefined {
  const host = headers.get("host");
  if (!host || !localHosts.has(hostname(host) ?? ""))
    return "desk only answers on localhost";
  if (!mutating) return undefined;

  const origin = headers.get("origin");
  let url: URL | undefined;
  try {
    url = origin ? new URL(origin) : undefined;
  } catch {
    url = undefined;
  }
  if (!url || url.protocol !== "http:" || url.host !== host)
    return "cross-origin request";

  const type = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return "expected application/json";
  return undefined;
}

/** A 403 response if the request is refused, else `undefined`. */
export function guard(
  request: Request,
  options: { mutating: boolean }
): Response | undefined {
  const reason = refusal(request.headers, options);
  return reason === undefined
    ? undefined
    : Response.json({ error: reason }, { status: 403 });
}
