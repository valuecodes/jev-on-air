"use client";

import type { JevEvent } from "@repo/jev/ledger";
import type { Decision } from "@repo/jev/schema";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { badge, card, field, row } from "./ui";
import { useRunStream } from "./useRunStream";

const entry =
  "grid grid-cols-[4.5rem_1fr] gap-2 rounded px-1.5 py-0.5 [overflow-wrap:anywhere]";
const time = "pt-0.5 font-mono text-xs text-muted";
const cell = "border-b border-line py-1 pr-3 text-left whitespace-nowrap";

const instrumentNames: Record<Decision["instrument"], string> = {
  gold: "Gold",
  bitcoin: "Bitcoin",
  sp500: "S&P 500",
  oil: "Oil",
};

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

  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <div className={row}>
          <Link href="/">← all runs</Link>
          <h2 className="min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere]">
            {id}
          </h2>
          <span className={badge(stream.connected ? "good" : "bad")}>
            {stream.connected ? "connected" : "disconnected"}
          </span>
          {stream.run && <RunState run={stream.run} />}
          {stream.run && <StopButton run={stream.run} />}
        </div>
        {groups.length > 1 && (
          <label className="flex items-center gap-1.5">
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
        {stream.run?.error && <p className="text-bad">{stream.run.error}</p>}
        {stream.notices.map((notice, key) => (
          <p key={key} className="text-warn">
            {notice}
          </p>
        ))}
      </section>

      {group ? (
        <>
          <Summary start={start} book={book} events={events} />
          <section className={card}>
            <div className={row}>
              <h2 className="min-w-0 flex-1 text-base font-semibold [overflow-wrap:anywhere]">
                Timeline
              </h2>
              {transcript.match === "approximate" && (
                <span
                  className={badge("warn")}
                  title="Matched to this run by order; the transcript file holds every session for this video"
                >
                  transcript approximate
                </span>
              )}
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showSnapshots}
                  onChange={(event) => setShowSnapshots(event.target.checked)}
                />
                snapshots
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(event) => setFollow(event.target.checked)}
                />
                follow
              </label>
            </div>
            <ol className="flex flex-col gap-0.5">
              {items.map((item) => (
                <Item key={item.key} item={item} />
              ))}
            </ol>
            <div ref={end} />
          </section>
        </>
      ) : (
        <section className={`${card} text-muted`}>
          {stream.connected ? "No ledger events yet." : "Connecting…"}
        </section>
      )}

      <section className={card}>
        <details open={stream.run?.state === "failed"}>
          <summary>CLI output ({stream.output.length} lines)</summary>
          {stream.output.length ? (
            <pre className="mt-2 max-h-90 overflow-auto font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap">
              {stream.output.map((line) => (
                <span
                  key={line.seq}
                  className={
                    line.stream === "stderr" ? "text-muted" : undefined
                  }
                >
                  {line.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          ) : (
            <p className="text-muted">
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
  return (
    <section className={card}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
        <Stat
          label="Equity"
          value={equity === undefined ? "—" : money(equity)}
        />
        <Stat
          label="Run P&L"
          value={pnl === undefined ? "—" : signed(pnl)}
          tone={pnl === undefined ? undefined : pnl >= 0 ? "good" : "bad"}
        />
        <Stat
          label="Cash"
          value={book ? money(book.cash) : start ? money(start.cash) : "—"}
        />
        <Stat label="Realized" value={book ? signed(book.realized) : "—"} />
        <Stat label="Unrealized" value={book ? signed(book.unrealized) : "—"} />
        <Stat label="Model" value={start?.model ?? "—"} />
        <Stat label="Size" value={start ? percent(start.size) : "—"} />
      </div>
      {curve.length > 1 && <Sparkline values={curve} />}
      {book && book.positions.length > 0 && (
        <table className="block w-full border-collapse overflow-x-auto">
          <thead>
            <tr>
              <th className={cell}>Instrument</th>
              <th className={cell}>Side</th>
              <th className={cell}>Quantity</th>
              <th className={cell}>Avg price</th>
              <th className={cell}>Mark</th>
              <th className={cell}>Unrealized</th>
            </tr>
          </thead>
          <tbody>
            {book.positions.map((position) => (
              <tr key={position.instrument}>
                <td className={cell}>{instrumentNames[position.instrument]}</td>
                <td className={cell}>{position.side}</td>
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
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
      <span className="text-muted">{label}</span>
      <strong
        className={`text-lg ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}
      >
        {value}
      </strong>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${30 - ((value - min) / span) * 28 - 1}`
    )
    .join(" ");
  return (
    <svg
      className="h-15 w-full"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={2}
        className="stroke-accent"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Item({ item }: { item: TimelineItem }) {
  if (item.kind === "segment")
    return (
      <li className={`${entry} text-muted`}>
        <span className={time}>{audio(item.segment.start)}</span>
        <span>{item.segment.text}</span>
      </li>
    );
  const { event } = item;
  const at = <span className={time}>{clock(event.time)}</span>;
  switch (event.type) {
    case "start":
      return (
        <li className={entry}>
          {at}
          <span>
            Started {event.source} with {money(event.equity)} equity
            {event.resumed ? " (resumed portfolio)" : ""}
          </span>
        </li>
      );
    case "decision":
      return (
        <li className={`${entry} border-accent border-l-3`}>
          {at}
          <div>
            <div className={row}>
              <strong>Turn {event.turn}</strong>
              {event.signal !== null && (
                <span
                  className={badge(event.signal >= 0.5 ? "good" : "neutral")}
                >
                  signal {percent(event.signal)}
                </span>
              )}
              <span className="text-muted">
                {event.latencyMs} ms · {event.segments} lines
                {event.usage
                  ? ` · ${event.usage.inputTokens}/${event.usage.outputTokens} tokens`
                  : ""}
              </span>
            </div>
            {event.decisions.length === 0 ? (
              <span className="text-muted">hold</span>
            ) : (
              <ul className="mt-1 list-disc pl-5">
                {event.decisions.map((decision) => (
                  <li key={decision.instrument}>
                    <strong>{decision.action.toUpperCase()}</strong>{" "}
                    {instrumentNames[decision.instrument]}{" "}
                    {percent(decision.confidence)}
                    {decision.probabilities && (
                      <span className="text-muted">
                        {" "}
                        (
                        {Object.entries(decision.probabilities)
                          .map(([choice, p]) => `${choice} ${percent(p)}`)
                          .join(", ")}
                        )
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      );
    case "fill":
      return (
        <li className={`${entry} bg-fill`}>
          {at}
          <span>
            <strong>FILL</strong> {event.action}{" "}
            {instrumentNames[event.instrument]} {event.quantity.toPrecision(6)}{" "}
            @ {money(event.price)} · {money(event.notional)}
            {event.realizedPnl !== 0 &&
              ` · realized ${signed(event.realizedPnl)}`}
          </span>
        </li>
      );
    case "reject":
      return (
        <li className={`${entry} bg-reject`}>
          {at}
          <span>
            <strong>REJECT</strong> {event.action}{" "}
            {instrumentNames[event.instrument]} {percent(event.confidence)}:{" "}
            {event.reason}
          </span>
        </li>
      );
    case "snapshot":
      return (
        <li className={entry}>
          {at}
          <span className="text-muted">
            equity {money(event.equity)} · cash {money(event.cash)} · exposure{" "}
            {money(event.grossExposure)}
          </span>
        </li>
      );
    case "error":
      return (
        <li className={`${entry} bg-error text-bad`}>
          {at}
          <span>
            <strong>ERROR</strong> {event.kind}: {event.message}
            {event.retryable ? " (will retry)" : ""}
          </span>
        </li>
      );
    case "end":
      return (
        <li className={entry}>
          {at}
          <span>
            Ended ({event.reason}) with {money(event.equity)} equity
          </span>
        </li>
      );
  }
}
