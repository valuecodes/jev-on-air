"use client";

import { useState } from "react";

import type { RunSummary, RunState as State } from "../lib/types";
import { postJson } from "./api";
import { badge, dangerButton } from "./ui";
import type { Tone } from "./ui";

export const isActive = (run: RunSummary): boolean =>
  run.state === "starting" ||
  run.state === "running" ||
  run.state === "stopping";

const stateTones: Record<State, Tone> = {
  starting: "warn",
  running: "good",
  stopping: "warn",
  exited: "neutral",
  failed: "bad",
};

export function RunState({ run }: { run: RunSummary }) {
  const detail =
    run.state === "exited" || run.state === "failed"
      ? run.signal
        ? ` (${run.signal})`
        : run.exitCode !== null
          ? ` (exit ${run.exitCode})`
          : ""
      : "";
  return (
    <span className={badge(stateTones[run.state])}>
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
      await postJson("/api/runs/stop", {});
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
        {run.state === "stopping" ? "Stopping…" : "Stop"}
      </button>
      {error && <span className="text-bad">{error}</span>}
    </>
  );
}
