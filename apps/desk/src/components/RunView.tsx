"use client";

import type { JevEvent } from "@repo/jev/ledger";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  Ban,
  Banknote,
  Camera,
  CircleCheck,
  Cpu,
  Mic,
  Pause,
  Percent,
  Play,
  Radio,
  Square,
  Target,
  Terminal,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
  WifiOff,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  buildTimeline,
  equityCurve,
  groupRuns,
  latestBook,
  transcriptForRun,
} from "../lib/timeline";
import type { Book, TimelineItem } from "../lib/timeline";
import { audio, clock, money, percent, signed } from "./format";
import { RunState, StopButton } from "./RunControls";
import { badge, card, field, heading, mono, row } from "./ui";
import { useRunStream } from "./useRunStream";
import {
  ActionPill,
  InstrumentChip,
  instruments,
  LiveDot,
  Meter,
  SignalMeter,
} from "./visuals";

const cell = "border-b border-line py-1.5 pr-4 text-left whitespace-nowrap";
const toggle =
  "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 text-xs select-none";

export function RunView({ id }: { id: string }) {
  const stream = useRunStream(id);
  const groups = useMemo(() => groupRuns(stream.ledger), [stream.ledger]);
  const [picked, setPicked] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [follow, setFollow] = useState(true);

  // The latest run unless one was picked.
  const index = picked
    ? groups.findIndex((group) => group.run === picked)
    : groups.length - 1;
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

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow) end.current?.scrollIntoView({ block: "end" });
  }, [follow, items.length]);

  const book = latestBook(events);
  const start = group?.start;
  const live =
    stream.connected && group !== undefined && events.at(-1)?.type !== "end";

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <div className={row}>
          <Link
            href="/"
            className="text-muted hover:text-accent inline-flex items-center gap-1 hover:no-underline"
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
          <label className="text-muted flex items-center gap-2 text-xs">
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
        {stream.run?.error && (
          <p className="text-bad flex items-center gap-2">
            <TriangleAlert className="size-4" aria-hidden />
            {stream.run.error}
          </p>
        )}
        {stream.notices.map((notice, key) => (
          <p key={key} className="text-warn flex items-center gap-2">
            <TriangleAlert className="size-4" aria-hidden />
            {notice}
          </p>
        ))}
      </section>

      {group ? (
        <>
          <Summary start={start} book={book} events={events} />
          <section className={card}>
            <div className={row}>
              <h2 className={`${heading} flex-1`}>
                <Activity className="text-accent size-4" aria-hidden />
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
            <ol className="flex flex-col gap-1">
              {items.map((item) => (
                <Item key={item.key} item={item} />
              ))}
            </ol>
            <div ref={end} />
          </section>
        </>
      ) : (
        <section className={`${card} text-muted items-center py-10`}>
          <Radio className="size-8 animate-pulse" aria-hidden />
          {stream.connected ? "No ledger events yet." : "Connecting…"}
        </section>
      )}

      <section className={card}>
        <details open={stream.run?.state === "failed"}>
          <summary className={`${heading} cursor-pointer`}>
            <Terminal className="text-accent-2 size-4" aria-hidden />
            CLI output ({stream.output.length} lines)
          </summary>
          {stream.output.length ? (
            <pre className="border-line bg-page mt-3 max-h-90 overflow-auto rounded-lg border p-3 font-mono text-xs wrap-anywhere whitespace-pre-wrap">
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
            <p className="text-muted mt-2">
              Output is only captured for runs started from desk.
            </p>
          )}
        </details>
      </section>
    </div>
  );
}

function Summary({
  start,
  book,
  events,
}: {
  start: Extract<JevEvent, { type: "start" }> | undefined;
  book: Book | undefined;
  events: JevEvent[];
}) {
  const curve = equityCurve(events);
  const equity = book?.equity ?? start?.equity;
  const pnl = equity !== undefined && start ? equity - start.equity : undefined;
  const up = pnl === undefined || pnl >= 0;
  return (
    <section className={card}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        <Stat
          icon={Wallet}
          label="Equity"
          value={equity === undefined ? "—" : money(equity)}
        />
        <Stat
          icon={up ? TrendingUp : TrendingDown}
          label="Run P&L"
          value={pnl === undefined ? "—" : signed(pnl)}
          detail={
            pnl === undefined || !start || start.equity === 0
              ? undefined
              : `${pnl >= 0 ? "+" : ""}${((pnl / start.equity) * 100).toFixed(2)}%`
          }
          tone={pnl === undefined ? undefined : up ? "good" : "bad"}
        />
        <Stat
          icon={Banknote}
          label="Cash"
          value={book ? money(book.cash) : start ? money(start.cash) : "—"}
        />
        <Stat
          icon={Target}
          label="Realized"
          value={book ? signed(book.realized) : "—"}
          tone={book ? (book.realized >= 0 ? "good" : "bad") : undefined}
        />
        <Stat
          icon={Activity}
          label="Unrealized"
          value={book ? signed(book.unrealized) : "—"}
          tone={book ? (book.unrealized >= 0 ? "good" : "bad") : undefined}
        />
        <Stat icon={Cpu} label="Model" value={start?.model ?? "—"} />
        <Stat
          icon={Percent}
          label="Size"
          value={start ? percent(start.size) : "—"}
        />
      </div>
      {curve.length > 1 && <EquityChart values={curve} up={up} />}
      {book && book.positions.length > 0 && (
        <table className="block w-full border-collapse overflow-x-auto">
          <thead className="text-muted text-xs tracking-wider uppercase">
            <tr>
              <th className={cell}>Instrument</th>
              <th className={cell}>Side</th>
              <th className={cell}>Quantity</th>
              <th className={cell}>Avg price</th>
              <th className={cell}>Mark</th>
              <th className={cell}>Unrealized</th>
            </tr>
          </thead>
          <tbody className={mono}>
            {book.positions.map((position) => (
              <tr key={position.instrument}>
                <td className={cell}>
                  <InstrumentChip id={position.instrument} />
                </td>
                <td className={cell}>
                  <span
                    className={badge(position.side === "long" ? "good" : "bad")}
                  >
                    {position.side === "long" ? (
                      <TrendingUp className="size-3.5" aria-hidden />
                    ) : (
                      <TrendingDown className="size-3.5" aria-hidden />
                    )}
                    {position.side}
                  </span>
                </td>
                <td className={cell}>{position.quantity.toPrecision(6)}</td>
                <td className={cell}>{money(position.avgPrice)}</td>
                <td className={cell}>{money(position.price)}</td>
                <td
                  className={`${cell} ${position.unrealizedPnl >= 0 ? "text-good" : "text-bad"}`}
                >
                  {signed(position.unrealizedPnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: "good" | "bad" | undefined;
}) {
  const color =
    tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink";
  const frame =
    tone === "good"
      ? "border-good/30 bg-good/5"
      : tone === "bad"
        ? "border-bad/30 bg-bad/5"
        : "border-line bg-raised/50";
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-lg border p-3 wrap-anywhere ${frame}`}
    >
      <span className="text-muted flex items-center gap-1.5 text-xs tracking-wider uppercase">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <strong className={`${mono} text-lg ${color}`}>{value}</strong>
      {detail && <span className={`${mono} text-xs ${color}`}>{detail}</span>}
    </div>
  );
}

/** Equity as a filled area, green when the run is up, red when down. */
function EquityChart({ values, up }: { values: number[]; up: boolean }) {
  const gradient = useId();
  const first = values[0] ?? 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (value: number): number => 38 - ((value - min) / span) * 34;
  const x = (index: number): number => (index / (values.length - 1)) * 100;
  const line = values
    .map((value, index) => `${x(index)},${y(value)}`)
    .join(" ");
  const color = up ? "var(--color-good)" : "var(--color-bad)";
  return (
    <svg
      className="h-24 w-full"
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Equity from ${money(first)} to ${money(values.at(-1) ?? first)}`}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        x1="0"
        x2="100"
        y1={y(first)}
        y2={y(first)}
        stroke="var(--color-muted)"
        strokeDasharray="2 2"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={`0,40 ${line} 100,40`} fill={`url(#${gradient})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** One timeline row: time, an icon on a coloured rail, then the content. */
function Row({
  at,
  icon: Icon,
  rail,
  tint = "",
  children,
}: {
  at: string;
  icon: LucideIcon;
  rail: string;
  tint?: string;
  children: ReactNode;
}) {
  return (
    <li
      className={`grid grid-cols-[4.5rem_1.5rem_1fr] items-start gap-2 rounded-lg border-l-2 px-2 py-1.5 wrap-anywhere ${rail} ${tint}`}
    >
      <span className={`${mono} text-muted pt-0.5 text-xs`}>{at}</span>
      <Icon className="mt-0.5 size-4" aria-hidden />
      <div className="min-w-0">{children}</div>
    </li>
  );
}

function Item({ item }: { item: TimelineItem }) {
  if (item.kind === "segment")
    return (
      <li className="text-muted grid grid-cols-[4.5rem_1.5rem_1fr] items-start gap-2 px-2 py-0.5 wrap-anywhere">
        <span className={`${mono} pt-0.5 text-xs opacity-70`}>
          {audio(item.segment.start)}
        </span>
        <Mic className="mt-1 size-3 opacity-50" aria-hidden />
        <span>{item.segment.text}</span>
      </li>
    );
  const { event } = item;
  const at = clock(event.time);
  switch (event.type) {
    case "start":
      return (
        <Row at={at} icon={Play} rail="border-accent text-accent">
          <span className="text-ink">
            Started <span className="font-mono">{event.source}</span> with{" "}
            <span className={mono}>{money(event.equity)}</span> equity
            {event.resumed ? " (resumed portfolio)" : ""}
          </span>
        </Row>
      );
    case "decision":
      return (
        <Row
          at={at}
          icon={Zap}
          rail="border-accent-2 text-accent-2"
          tint="bg-accent-2/5"
        >
          <div className="text-ink flex flex-col gap-1.5">
            <div className={row}>
              <strong className="text-accent-2">Turn {event.turn}</strong>
              {event.signal !== null && <SignalMeter signal={event.signal} />}
              <span className={`${mono} text-muted text-xs`}>
                {event.latencyMs} ms · {event.segments} lines
                {event.usage
                  ? ` · ${event.usage.inputTokens}/${event.usage.outputTokens} tok`
                  : ""}
              </span>
            </div>
            {event.decisions.length === 0 ? (
              <span className="text-muted inline-flex items-center gap-1 text-xs">
                <Pause className="size-3.5" aria-hidden />
                hold
              </span>
            ) : (
              <ul className="flex flex-col gap-1">
                {event.decisions.map((decision) => (
                  <li
                    key={decision.instrument}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <ActionPill action={decision.action} />
                    <InstrumentChip id={decision.instrument} />
                    <Meter
                      value={decision.confidence}
                      fill={instruments[decision.instrument].bar}
                      label="confidence"
                    />
                    {decision.probabilities && (
                      <span className={`${mono} text-muted text-xs`}>
                        {Object.entries(decision.probabilities)
                          .map(([choice, p]) => `${choice} ${percent(p)}`)
                          .join(" · ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Row>
      );
    case "fill":
      return (
        <Row
          at={at}
          icon={CircleCheck}
          rail="border-good text-good"
          tint="bg-good/10"
        >
          <div className="text-ink flex flex-wrap items-center gap-2">
            <strong className="text-good">FILL</strong>
            <ActionPill action={event.action} />
            <InstrumentChip id={event.instrument} />
            <span className={mono}>
              {event.quantity.toPrecision(6)} @ {money(event.price)} ·{" "}
              {money(event.notional)}
            </span>
            {event.realizedPnl !== 0 && (
              <span
                className={`${mono} ${event.realizedPnl >= 0 ? "text-good" : "text-bad"}`}
              >
                realized {signed(event.realizedPnl)}
              </span>
            )}
          </div>
        </Row>
      );
    case "reject":
      return (
        <Row at={at} icon={Ban} rail="border-warn text-warn" tint="bg-warn/10">
          <div className="text-ink flex flex-wrap items-center gap-2">
            <strong className="text-warn">REJECT</strong>
            <ActionPill action={event.action} />
            <InstrumentChip id={event.instrument} />
            <span className={`${mono} text-xs`}>
              {percent(event.confidence)}
            </span>
            <span className="text-muted">{event.reason}</span>
          </div>
        </Row>
      );
    case "snapshot":
      return (
        <Row at={at} icon={Camera} rail="border-line text-muted">
          <span className={`${mono} text-muted text-xs`}>
            equity {money(event.equity)} · cash {money(event.cash)} · exposure{" "}
            {money(event.grossExposure)}
          </span>
        </Row>
      );
    case "error":
      return (
        <Row
          at={at}
          icon={TriangleAlert}
          rail="border-bad text-bad"
          tint="bg-bad/10"
        >
          <span className="text-bad">
            <strong>ERROR</strong> {event.kind}: {event.message}
            {event.retryable ? " (will retry)" : ""}
          </span>
        </Row>
      );
    case "end":
      return (
        <Row at={at} icon={Square} rail="border-accent text-accent">
          <span className="text-ink">
            Ended ({event.reason}) with{" "}
            <span className={mono}>{money(event.equity)}</span> equity
          </span>
        </Row>
      );
  }
}
