"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { LedgerInfo, RunSummary } from "../lib/types";
import { postJson } from "./api";
import { clock } from "./format";
import { isActive, RunState, StopButton } from "./RunControls";
import { badge, button, card, field, row } from "./ui";

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
        <h2 className="text-base font-semibold">New run</h2>
        {active ? (
          <div className={row}>
            <span>
              Running{" "}
              <Link href={`/runs/${active.videoId}`}>{active.videoId}</Link>
            </span>
            <RunState run={active} />
            <StopButton run={active} />
          </div>
        ) : (
          <NewRunForm />
        )}
      </section>

      {overview && overview.runs.some((run) => run !== active) && (
        <section className={card}>
          <h2 className="text-base font-semibold">Recent desk runs</h2>
          <ul className="flex flex-col gap-1.5">
            {overview.runs
              .filter((run) => run !== active)
              .map((run) => (
                <li key={run.id} className={row}>
                  <Link href={`/runs/${run.videoId}`}>{run.videoId}</Link>
                  <span className="text-muted">{clock(run.startedAt)}</span>
                  <RunState run={run} />
                  {run.error && <span className="text-bad">{run.error}</span>}
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className={card}>
        <h2 className="text-base font-semibold">Ledgers</h2>
        {loadError && <p className="text-bad">Could not load: {loadError}</p>}
        {overview?.ledgers.length === 0 && (
          <p className="text-muted">
            No runs yet. Start one above or with <code>pnpm cli jev</code>.
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {overview?.ledgers.map((ledger) => (
            <li key={ledger.id} className={row}>
              <Link href={`/runs/${ledger.id}`}>
                {ledger.title ?? ledger.id}
              </Link>
              {ledger.channel && (
                <span className="text-muted">{ledger.channel}</span>
              )}
              {ledger.live && (
                <span className={badge("good")}>
                  {active?.videoId === ledger.id ? "live" : "live · external"}
                </span>
              )}
              <span className="text-muted">
                {new Date(ledger.updatedAt).toLocaleString("en-GB")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
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
        YouTube URL
        <input
          type="url"
          className={`${field} w-full`}
          required
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <div className={row}>
        <label className="flex flex-col gap-1">
          Size
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
          Min signal
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
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={reset}
            onChange={(event) => setReset(event.target.checked)}
          />
          Reset the shared portfolio
        </label>
      </div>
      <div className={row}>
        <button type="submit" className={button} disabled={busy}>
          {busy ? "Starting…" : "Start"}
        </button>
        {error && <span className="text-bad">{error}</span>}
      </div>
    </form>
  );
}
