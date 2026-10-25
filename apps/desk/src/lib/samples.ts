// Recorded events desk can replay with one click. Their transcript, sidecar
// and ticks live in apps/cli/samples/<id>.*, so a sample's id is also its
// ledger id. No Node imports here, so the home page can list them.

type Sample = {
  id: string;
  title: string;
  description: string;
  /** Delay applied to every transcript line, like a live viewer's. */
  lagSeconds: number;
};

const SAMPLES: readonly Sample[] = [
  {
    id: "fomc-2026-09-16",
    title: "FOMC press conference, 16 Sep 2026",
    description:
      "Chair Warsh after the first hike since 2023. Stocks and gold slid through the presser.",
    lagSeconds: 20,
  },
];

const findSample = (id: string): Sample | undefined =>
  SAMPLES.find((sample) => sample.id === id);

/** Fast runs on a virtual clock; paced plays in real time, like the video. */
const SAMPLE_MODES = ["fast", "paced"] as const;
type SampleMode = (typeof SAMPLE_MODES)[number];

export { findSample, SAMPLE_MODES, SAMPLES };
export type { Sample, SampleMode };
