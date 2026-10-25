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

import type { RunSummary, RunState as State } from "~/lib/types";

import { postJson } from "./api";
import { badge, dangerButton } from "./ui";
import type { Tone } from "./ui";

const isActive = (run: RunSummary): boolean =>
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

/** Why a finished run ended, as ` (SIGTERM)` or ` (exit 1)`; else empty. */
const endDetail = (run: RunSummary): string => {
  if (run.state !== "exited" && run.state !== "failed") {
    return "";
  }
  if (run.signal !== null && run.signal !== "") {
    return ` (${run.signal})`;
  }
  if (run.exitCode !== null) {
    return ` (exit ${run.exitCode})`;
  }
  return "";
};

const RunState = ({ run }: { run: RunSummary }) => {
  const { tone, icon: Icon, spin } = looks[run.state];
  return (
    <span className={badge(tone)}>
      <Icon
        className={`size-3.5 ${spin === true ? "animate-spin" : ""}`}
        aria-hidden
      />
      {run.state}
      {endDetail(run)}
    </span>
  );
};

const StopButton = ({ run }: { run: RunSummary }) => {
  const [error, setError] = useState<string | null>(null);
  if (!isActive(run)) {
    return null;
  }
  const stop = async (): Promise<void> => {
    try {
      await postJson("/api/runs/stop", { id: run.id });
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
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
      {error !== null && error !== "" && (
        <span className="text-bad">{error}</span>
      )}
    </>
  );
};

export { isActive, RunState, StopButton };
