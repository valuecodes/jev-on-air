// Class strings shared by several components.

export const card =
  "flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-card p-4";

export const row = "flex flex-wrap items-center gap-x-3 gap-y-2";

export const field =
  "rounded-md border border-line bg-page px-2.5 py-1.5 text-ink";

export const button =
  "cursor-pointer rounded-md border border-accent bg-accent px-2.5 py-1.5 text-white disabled:cursor-default disabled:opacity-60";

export const dangerButton =
  "cursor-pointer rounded-md border border-bad bg-bad px-2.5 py-1.5 text-white disabled:cursor-default disabled:opacity-60";

export type Tone = "neutral" | "good" | "warn" | "bad";

const tones: Record<Tone, string> = {
  neutral: "border-line text-muted",
  good: "border-good text-good",
  warn: "border-warn text-warn",
  bad: "border-bad text-bad",
};

export const badge = (tone: Tone): string =>
  `inline-block rounded-full border px-2 text-xs ${tones[tone]}`;
