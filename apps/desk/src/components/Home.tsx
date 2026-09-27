"use client";

import {
  ExternalLink,
  FastForward,
  FileText,
  History,
  Library,
  LoaderCircle,
  Play,
  Rocket,
  RotateCcw,
  TriangleAlert,
  Tv,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { SAMPLES } from "../lib/samples";
import type { Sample, SampleMode } from "../lib/samples";
import type { LedgerInfo, RunSummary } from "../lib/types";
import { postJson } from "./api";
import { clock } from "./format";
import { isActive, RunState, StopButton } from "./RunControls";
import { badge, button, card, field, heading, mono, row } from "./ui";
import { LiveDot } from "./visuals";

const listRow = "rounded-lg px-2 py-1.5 transition hover:bg-raised";

type Overview = { runs: RunSummary[]; ledgers: LedgerInfo[] };

const REFRESH_MS = 3000;

export function Home() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch("/api/runs", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as Overview;
        if (!cancelled) {
          setOverview(data);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const active = overview?.runs.find(isActive);

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <h2 className={heading}>
          <Rocket className="text-accent size-4" aria-hidden />
          New run
        </h2>
        {active ? (
          <div className={row}>
            <LiveDot />
            <span>
              Running{" "}
              <Link href={`/runs/${active.videoId}`} className="font-mono">
                {active.videoId}
              </Link>
            </span>
            <RunState run={active} />
            <StopButton run={active} />
          </div>
        ) : (
          <NewRunForm />
        )}
      </section>

      <section className={card}>
        <h2 className={heading}>
          <Tv className="text-accent size-4" aria-hidden />
          Sample events
        </h2>
        <p className="text-muted text-xs">
          A recorded transcript and prices, replayed through the real Jev on a
          fresh scratch book.
        </p>
        <ul className="flex flex-col gap-2">
          {SAMPLES.map((sample) => (
            <SampleRow key={sample.id} sample={sample} disabled={!!active} />
          ))}
        </ul>
      </section>

      {overview && overview.runs.some((run) => run !== active) && (
        <section className={card}>
          <h2 className={heading}>
            <History className="text-accent-2 size-4" aria-hidden />
            Recent desk runs
          </h2>
          <ul className="flex flex-col gap-1">
            {overview.runs
              .filter((run) => run !== active)
              .map((run) => (
                <li key={run.id} className={`${row} ${listRow}`}>
                  <Link href={`/runs/${run.videoId}`} className="font-mono">
                    {run.videoId}
                  </Link>
                  <span className={`${mono} text-muted`}>
                    {clock(run.startedAt)}
                  </span>
                  <RunState run={run} />
                  {run.error && <span className="text-bad">{run.error}</span>}
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className={heading}>
          <Library className="text-accent size-4" aria-hidden />
          Ledgers
        </h2>
        {loadError && (
          <p className="text-bad flex items-center gap-2">
            <TriangleAlert className="size-4" aria-hidden />
            Could not load: {loadError}
          </p>
        )}
        {overview?.ledgers.length === 0 && (
          <p className="text-muted">
            No runs yet. Start one above or with <code>pnpm cli jev</code>.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {overview?.ledgers.map((ledger) => (
            <li key={ledger.id} className={`${row} ${listRow}`}>
              <FileText className="text-muted size-4 shrink-0" aria-hidden />
              <Link
                href={`/runs/${ledger.id}`}
                className="text-ink min-w-0 font-medium wrap-anywhere"
              >
                {ledger.title ?? ledger.id}
              </Link>
              {ledger.channel && (
                <span className="text-muted">{ledger.channel}</span>
              )}
              {ledger.live && (
                <span className={badge("good")}>
                  <LiveDot />
                  LIVE
                  {active?.videoId !== ledger.id && (
                    <>
                      {" "}
                      · external
                      <ExternalLink className="size-3" aria-hidden />
                    </>
                  )}
                </span>
              )}
              <span className={`${mono} text-muted ml-auto text-xs`}>
                {new Date(ledger.updatedAt).toLocaleString("en-GB")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SampleRow({
  sample,
  disabled,
}: {
  sample: Sample;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<SampleMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (mode: SampleMode): Promise<void> => {
    setBusy(mode);
    setError(null);
    try {
      const run = (await postJson("/api/runs", {
        sample: sample.id,
        mode,
      })) as RunSummary;
      router.push(`/runs/${run.videoId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(null);
    }
  };

  const modes: { mode: SampleMode; label: string; icon: typeof Play }[] = [
    { mode: "fast", label: "Fast", icon: FastForward },
    { mode: "paced", label: "Watch along", icon: Play },
  ];
  return (
    <li className={`${row} ${listRow}`}>
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/runs/${sample.id}`}
          className="text-ink font-medium wrap-anywhere"
        >
          {sample.title}
        </Link>
        <span className="text-muted text-xs">{sample.description}</span>
      </span>
      {modes.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          className={button}
          disabled={disabled || busy !== null}
          title={
            mode === "fast"
              ? "As fast as Jev answers, on a virtual clock"
              : "In real time, next to the video"
          }
          onClick={() => void start(mode)}
        >
          {busy === mode ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <Icon className="size-4 fill-current" aria-hidden />
          )}
          {label}
        </button>
      ))}
      {error && (
        <span className="text-bad flex items-center gap-1.5">
          <TriangleAlert className="size-4" aria-hidden />
          {error}
        </span>
      )}
    </li>
  );
}

function NewRunForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [size, setSize] = useState("");
  const [minSignal, setMinSignal] = useState("");
  const [reset, setReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const run = (await postJson("/api/runs", {
        url,
        ...(size.trim() === "" ? {} : { size: Number(size) }),
        ...(minSignal.trim() === "" ? {} : { minSignal: Number(minSignal) }),
        reset,
      })) as RunSummary;
      router.push(`/runs/${run.videoId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => void submit(event)}
    >
      <label className="flex flex-col gap-1">
        <span className="text-muted text-xs">YouTube URL</span>
        <span className="relative">
          <Video
            className="text-muted pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="url"
            className={`${field} w-full pl-8`}
            required
            placeholder="https://www.youtube.com/watch?v=…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </span>
      </label>
      <div className={row}>
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">Size</span>
          <input
            type="number"
            className={`${field} w-28`}
            step="any"
            min="0"
            max="1"
            placeholder="0.1"
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted text-xs">Min signal</span>
          <input
            type="number"
            className={`${field} w-28`}
            step="any"
            min="0"
            max="1"
            placeholder="0.5"
            value={minSignal}
            onChange={(event) => setMinSignal(event.target.value)}
          />
        </label>
        <label
          className={`flex items-center gap-1.5 self-end rounded-lg border px-2.5 py-1.5 ${reset ? "border-warn/50 bg-warn/10 text-warn" : "border-line text-muted"}`}
        >
          <input
            type="checkbox"
            checked={reset}
            onChange={(event) => setReset(event.target.checked)}
          />
          <RotateCcw className="size-3.5" aria-hidden />
          Reset the shared portfolio
        </label>
      </div>
      <div className={row}>
        <button type="submit" className={button} disabled={busy}>
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : (
            <Play className="size-4 fill-current" aria-hidden />
          )}
          {busy ? "Starting…" : "Start"}
        </button>
        {error && (
          <span className="text-bad flex items-center gap-1.5">
            <TriangleAlert className="size-4" aria-hidden />
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
