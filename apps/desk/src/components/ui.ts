// Class strings shared by several components. Tailwind only sees complete
// class names, so variants are spelled out rather than built from parts.

const card =
  "relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-line bg-card/90 p-4 shadow-[inset_0_1px_0_0_color-mix(in_oklab,var(--color-accent)_18%,transparent)]";

const row = "flex flex-wrap items-center gap-x-3 gap-y-2";

const heading =
  "flex items-center gap-2 text-xs font-semibold tracking-widest text-muted uppercase";

const field =
  "rounded-lg border border-line bg-raised px-2.5 py-1.5 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

const button =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 font-semibold text-page shadow-[0_0_18px_-4px_var(--color-accent)] transition hover:brightness-110 disabled:cursor-default disabled:opacity-60 disabled:shadow-none";

const dangerButton =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-bad px-3 py-1.5 font-semibold text-page shadow-[0_0_18px_-4px_var(--color-bad)] transition hover:brightness-110 disabled:cursor-default disabled:opacity-60 disabled:shadow-none";

const mono = "font-mono tabular-nums";

type Tone = "neutral" | "accent" | "good" | "warn" | "bad";

const tones: Record<Tone, string> = {
  neutral: "border-line bg-raised text-muted",
  accent: "border-accent/40 bg-accent/10 text-accent",
  good: "border-good/40 bg-good/10 text-good",
  warn: "border-warn/40 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
};

const badge = (tone: Tone): string =>
  `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`;

export { badge, button, card, dangerButton, field, heading, mono, row };
export type { Tone };
