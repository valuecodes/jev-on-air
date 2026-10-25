"use client";

import type { FillEvent, StartEvent } from "@repo/jev/ledger";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  Camera,
  ChartLine,
  Mic,
  Radio,
  Terminal,
  TriangleAlert,
  Tv,
  WifiOff,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildTimeline,
  groupRuns,
  latestBook,
  transcriptForRun,
} from "~/lib/timeline";
import type { RunTranscript } from "~/lib/timeline";
import type { VideoMeta } from "~/lib/types";
import { seekTarget } from "~/lib/video";

import { RunState, StopButton } from "./run-controls";
import { RunSummary } from "./run-summary";
import { TimelineItem } from "./timeline-item";
import { badge, card, field, heading, row } from "./ui";
import { useRunStream } from "./use-run-stream";
import type { PlayerHandle } from "./video-player";
import { LiveDot } from "./visuals";

const toggle =
  "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs select-none";

// Both need `window`, so they only render in the browser.
const VideoPlayer = dynamic(
  () => import("./video-player").then((module) => module.VideoPlayer),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-video w-full animate-pulse rounded-lg bg-raised" />
    ),
  }
);
const PriceChart = dynamic(
  () => import("./price-chart").then((module) => module.PriceChart),
  {
    ssr: false,
    loading: () => <div className="h-72 animate-pulse rounded-lg bg-raised" />,
  }
);

/**
 * The video to show: a live run's own, or the one a replay desk started
 * recorded in the sidecar.
 */
const videoIdFor = (
  start: StartEvent | undefined,
  match: RunTranscript["match"],
  meta: VideoMeta | null
): string | undefined => {
  if (start?.source.startsWith("youtube:") === true) {
    return start.source.slice("youtube:".length);
  }
  if (start?.source.startsWith("replay:") === true && match === "exact") {
    return meta?.video.id;
  }
  return undefined;
};

const RunView = ({ id }: { id: string }) => {
  const stream = useRunStream(id);
  const groups = useMemo(() => groupRuns(stream.ledger), [stream.ledger]);
  const [picked, setPicked] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [follow, setFollow] = useState(true);

  // The latest run unless one was picked.
  const index =
    picked === null
      ? groups.length - 1
      : groups.findIndex((group) => group.run === picked);
  const group = groups[index];
  const events = useMemo(() => group?.events ?? [], [group]);
  const transcript = useMemo(
    () => transcriptForRun(groups, index, stream.transcript, stream.run),
    [groups, index, stream.transcript, stream.run]
  );
  const items = useMemo(
    () =>
      buildTimeline(events, transcript.lines).filter(
        (item) =>
          showSnapshots ||
          item.kind !== "event" ||
          item.event.type !== "snapshot"
      ),
    [events, transcript.lines, showSnapshots]
  );

  // Follow within the timeline, so the page (and the video) stays put.
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const element = list.current;
    if (follow && element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [follow, items.length]);

  const book = latestBook(events);
  const start = group?.start;
  const last = events.at(-1);
  const live = stream.connected && group !== undefined && last?.type !== "end";

  // The transcript's sidecar, for mapping transcript time to video time.
  // Fetched again when a new run appears, since each session rewrites it,
  // and once its first transcript line lands: the CLI writes the sidecar
  // just before that line, so an earlier fetch finds nothing.
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const hasTranscript = stream.transcript.length > 0;
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/runs/${id}/meta`, { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as VideoMeta) : null
      )
      .then((value) => {
        if (!cancelled) {
          setMeta(value);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMeta(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, groups.length, hasTranscript]);

  const videoId = videoIdFor(start, transcript.match, meta);
  const hasVideo = videoId !== undefined && videoId !== "";
  const player = useRef<PlayerHandle | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const onPlayerReady = useCallback((handle: PlayerHandle | null) => {
    player.current = handle;
    setPlayerReady(handle !== null);
  }, []);
  const runStart = group?.run;
  const seek = useMemo(
    () =>
      playerReady && runStart !== undefined
        ? (audioTime: number) =>
            player.current?.seek(seekTarget(audioTime, meta, runStart))
        : undefined,
    [playerReady, runStart, meta]
  );
  // Watching a sample along: once the player is ready, start the video at
  // the latest line replayed, so a page opened mid-run joins where it is.
  const latestLine = transcript.lines.at(-1)?.segment.end;
  const watching = stream.run?.mode === "paced" && live;
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (
      !watching ||
      !seek ||
      latestLine === undefined ||
      runStart === undefined
    ) {
      return;
    }
    if (started.current === runStart) {
      return;
    }
    started.current = runStart;
    seek(latestLine);
  }, [watching, seek, latestLine, runStart]);
  const fills = useMemo(
    () => events.filter((event): event is FillEvent => event.type === "fill"),
    [events]
  );
  const runError = stream.run?.error;

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <div className={row}>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-muted hover:text-accent hover:no-underline"
          >
            <ArrowLeft className="size-4" aria-hidden />
            all runs
          </Link>
          <h2 className="flex min-w-0 flex-1 items-center gap-2 font-mono text-lg font-bold wrap-anywhere">
            <Radio
              className={`size-5 shrink-0 ${live ? "text-good" : "text-muted"}`}
              aria-hidden
            />
            {id}
          </h2>
          {live && (
            <span className={badge("good")}>
              <LiveDot />
              LIVE
            </span>
          )}
          {!stream.connected && (
            <span className={badge("bad")}>
              <WifiOff className="size-3.5" aria-hidden />
              disconnected
            </span>
          )}
          {stream.run && <RunState run={stream.run} />}
          {stream.run && <StopButton run={stream.run} />}
        </div>
        {groups.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Run
            <select
              className={field}
              value={group?.run ?? ""}
              onChange={(event) => setPicked(event.target.value)}
            >
              {groups.map((candidate) => (
                <option key={candidate.run} value={candidate.run}>
                  {new Date(candidate.run).toLocaleString("en-GB")}
                  {candidate.start ? ` · ${candidate.start.source}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {runError !== undefined && runError !== null && runError !== "" && (
          <p className="flex items-center gap-2 text-bad">
            <TriangleAlert className="size-4" aria-hidden />
            {runError}
          </p>
        )}
        {stream.notices.map((notice, key) => (
          <p key={key} className="flex items-center gap-2 text-warn">
            <TriangleAlert className="size-4" aria-hidden />
            {notice}
          </p>
        ))}
      </section>

      {group ? (
        <>
          <RunSummary start={start} book={book} events={events} />
          {/* The video sets the row's height; the timeline scrolls within it. */}
          <div className={`grid gap-4 ${hasVideo ? "lg:grid-cols-2" : ""}`}>
            {hasVideo && (
              <section className={card}>
                <h2 className={heading}>
                  <Tv className="size-4 text-accent" aria-hidden />
                  {meta?.video.title ?? "Stream"}
                </h2>
                <VideoPlayer
                  videoId={videoId}
                  autoplay={start?.source.startsWith("youtube:") ?? false}
                  onReady={onPlayerReady}
                />
              </section>
            )}
            <section
              className={`${card} ${hasVideo ? "lg:h-0 lg:min-h-full" : ""}`}
            >
              <div className={row}>
                <h2 className={`${heading} flex-1`}>
                  <Activity className="size-4 text-accent" aria-hidden />
                  Timeline
                </h2>
                {transcript.match === "approximate" && (
                  <span
                    className={badge("warn")}
                    title="Matched to this run by order; the transcript file holds every session for this video"
                  >
                    <Mic className="size-3.5" aria-hidden />
                    transcript approximate
                  </span>
                )}
                <label
                  className={`${toggle} ${showSnapshots ? "border-accent/50 bg-accent/10 text-accent" : "border-line text-muted"}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={showSnapshots}
                    onChange={(event) => setShowSnapshots(event.target.checked)}
                  />
                  <Camera className="size-3.5" aria-hidden />
                  snapshots
                </label>
                <label
                  className={`${toggle} ${follow ? "border-accent/50 bg-accent/10 text-accent" : "border-line text-muted"}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={follow}
                    onChange={(event) => setFollow(event.target.checked)}
                  />
                  <ArrowDownToLine className="size-3.5" aria-hidden />
                  follow
                </label>
              </div>
              <ol
                ref={list}
                className={`flex max-h-[70vh] flex-col gap-1 overflow-y-auto pr-1 ${hasVideo ? "lg:max-h-none lg:min-h-0 lg:flex-1" : ""}`}
              >
                {items.map((item) => (
                  <TimelineItem key={item.key} item={item} onSeek={seek} />
                ))}
              </ol>
            </section>
          </div>
          <section className={card}>
            <h2 className={heading}>
              <ChartLine className="size-4 text-accent" aria-hidden />
              Prices
              <span className="font-normal tracking-normal normal-case">
                · % since the run started
              </span>
            </h2>
            <PriceChart
              points={stream.prices}
              fills={fills}
              from={Date.parse(start?.time ?? group.run)}
              to={last?.type === "end" ? Date.parse(last.time) : undefined}
            />
          </section>
        </>
      ) : (
        <section className={`${card} items-center py-10 text-muted`}>
          <Radio className="size-8 animate-pulse" aria-hidden />
          {stream.connected ? "No ledger events yet." : "Connecting…"}
        </section>
      )}

      <section className={card}>
        <details open={stream.run?.state === "failed"}>
          <summary className={`${heading} cursor-pointer`}>
            <Terminal className="size-4 text-accent-2" aria-hidden />
            CLI output ({stream.output.length} lines)
          </summary>
          {stream.output.length > 0 ? (
            <pre className="mt-3 max-h-90 overflow-auto rounded-lg border border-line bg-page p-3 font-mono text-xs wrap-anywhere whitespace-pre-wrap">
              {stream.output.map((line) => (
                <span
                  key={line.seq}
                  className={
                    line.stream === "stderr" ? "text-muted" : "text-good"
                  }
                >
                  {line.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          ) : (
            <p className="mt-2 text-muted">
              Output is only captured for runs started from desk.
            </p>
          )}
        </details>
      </section>
    </div>
  );
};

export { RunView };
