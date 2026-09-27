"use client";

import {
  CircleCheck,
  CircleDot,
  CircleX,
  LoaderCircle,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import type { RunSummary, RunState as State } from "../lib/types";
import { postJson } from "./api";
import { badge, dangerButton } from "./ui";
import type { Tone } from "./ui";

export const isActive = (run: RunSummary): boolean =>
  run.state === "starting" ||
  run.state === "running" ||
  run.state === "stopping";

const looks: Record<State, { tone: Tone; icon: LucideIcon; spin?: boolean }> = {
  starting: { tone: "warn", icon: LoaderCircle, spin: true },
  running: { tone: "good", icon: CircleDot },
  stopping: { tone: "warn", icon: LoaderCircle, spin: true },
  exited: { tone: "neutral", icon: CircleCheck },
  failed: { tone: "bad", icon: CircleX },
};

export function RunState({ run }: { run: RunSummary }) {
  const { tone, icon: Icon, spin } = looks[run.state];
  const detail =
    run.state === "exited" || run.state === "failed"
      ? run.signal
        ? ` (${run.signal})`
        : run.exitCode !== null
          ? ` (exit ${run.exitCode})`
          : ""
      : "";
  return (
    <span className={badge(tone)}>
      <Icon className={`size-3.5 ${spin ? "animate-spin" : ""}`} aria-hidden />
      {run.state}
      {detail}
    </span>
  );
}

export function StopButton({ run }: { run: RunSummary }) {
  const [error, setError] = useState<string | null>(null);
  if (!isActive(run)) return null;
  const stop = async (): Promise<void> => {
    try {
      await postJson("/api/runs/stop", { id: run.id });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <>
      <button
        type="button"
        className={dangerButton}
        disabled={run.state === "stopping"}
        onClick={() => void stop()}
      >
        <Square className="size-3.5 fill-current" aria-hidden />
        {run.state === "stopping" ? "Stopping…" : "Stop"}
      </button>
      {error && <span className="text-bad">{error}</span>}
    </>
  );
}
