// Number and time formatting for the UI.

const usd = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const money = (value: number): string => usd.format(value);

export const signed = (value: number): string =>
  `${value >= 0 ? "+" : "−"}${usd.format(Math.abs(value))}`;

export const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** `hh:mm:ss` in local time. */
export const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-GB", { hour12: false });

/** Audio seconds as `m:ss` or `h:mm:ss`. */
export function audio(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
