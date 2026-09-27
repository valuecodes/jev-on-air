"use client";

import { useState } from "react";

import type { RunSummary } from "../lib/types";
import { postJson } from "./api";

export const isActive = (run: RunSummary): boolean =>
  run.state === "starting" ||
  run.state === "running" ||
  run.state === "stopping";

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
    <span className={`badge ${run.state}`}>
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
        className="danger"
        disabled={run.state === "stopping"}
        onClick={() => void stop()}
      >
        {run.state === "stopping" ? "Stopping…" : "Stop"}
      </button>
      {error && <span className="bad">{error}</span>}
    </>
  );
}
