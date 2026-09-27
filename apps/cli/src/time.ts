// Times on the command line and in sidecars: a date, a time and a zone.
// Without the zone `Date.parse` would read the value in local time and shift
// every price by the machine's offset.

export const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** Whether `value` is an RFC 3339 time with a zone. */
export function isZonedTime(value: string): boolean {
  return RFC3339.test(value) && Number.isFinite(Date.parse(value));
}

/** Parses an RFC 3339 time with a zone and returns it normalised. */
export function parseTime(name: string, value: string): string {
  if (!isZonedTime(value))
    throw new Error(
      `--${name} must be an RFC 3339 time with a zone, like 2026-09-16T18:30:00Z, got ${value}`
    );
  return new Date(Date.parse(value)).toISOString();
}

/**
 * `env` without anything that looks like a credential, for child processes
 * that have no business seeing one.
 */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env))
    if (!/API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i.test(name))
      scrubbed[name] = value;
  return scrubbed;
}
