"use client";

// A run's portfolio: equity and P&L in the summary line, the stats, the
// equity curve and the open positions.
import type { JevEvent } from "@repo/jev/ledger";
import {
  Activity,
  Banknote,
  ChevronRight,
  Cpu,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useId } from "react";

import { equityCurve } from "~/lib/timeline";
import type { Book } from "~/lib/timeline";

import { money, percent, signed } from "./format";
import { badge, card, heading, mono } from "./ui";
import { InstrumentChip } from "./visuals";

type Tone = "good" | "bad" | undefined;

const cell = "border-b border-line py-1.5 pr-4 text-left whitespace-nowrap";

/** `good` at or above zero, `bad` below. */
const signTone = (value: number): "good" | "bad" =>
  value >= 0 ? "good" : "bad";

const textColor: Record<"good" | "bad" | "none", string> = {
  good: "text-good",
  bad: "text-bad",
  none: "text-ink",
};

const frameColor: Record<"good" | "bad" | "none", string> = {
  good: "border-good/30 bg-good/5",
  bad: "border-bad/30 bg-bad/5",
  none: "border-line bg-raised/50",
};

const Stat = ({
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
  tone?: Tone;
}) => {
  const color = textColor[tone ?? "none"];
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-lg border p-3 wrap-anywhere ${frameColor[tone ?? "none"]}`}
    >
      <span className="flex items-center gap-1.5 text-xs tracking-wider text-muted uppercase">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <strong className={`${mono} text-lg ${color}`}>{value}</strong>
      {detail !== undefined && detail !== "" && (
        <span className={`${mono} text-xs ${color}`}>{detail}</span>
      )}
    </div>
  );
};

/** Equity as a filled area, green when the run is up, red when down. */
const EquityChart = ({ values, up }: { values: number[]; up: boolean }) => {
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
};

const Positions = ({ book }: { book: Book }) => (
  <table className="block w-full border-collapse overflow-x-auto">
    <thead className="text-xs tracking-wider text-muted uppercase">
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
            <span className={badge(position.side === "long" ? "good" : "bad")}>
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
);

/** Cash from the latest book, else from the start; `—` with neither. */
const cashLabel = (
  book: Book | undefined,
  start: Extract<JevEvent, { type: "start" }> | undefined
): string => {
  if (book) {
    return money(book.cash);
  }
  return start ? money(start.cash) : "—";
};

const RunSummary = ({
  start,
  book,
  events,
}: {
  start: Extract<JevEvent, { type: "start" }> | undefined;
  book: Book | undefined;
  events: JevEvent[];
}) => {
  const curve = equityCurve(events);
  const equity = book?.equity ?? start?.equity;
  const pnl = equity !== undefined && start ? equity - start.equity : undefined;
  const up = pnl === undefined || pnl >= 0;
  const change =
    pnl === undefined || !start || start.equity === 0
      ? undefined
      : `${pnl >= 0 ? "+" : ""}${((pnl / start.equity) * 100).toFixed(2)}%`;
  const pnlTone = pnl === undefined ? undefined : signTone(pnl);
  return (
    <section className={card}>
      {/* Collapsed by default: equity and P&L stay in the summary line. */}
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 [&::-webkit-details-marker]:hidden">
          <span className={heading}>
            <ChevronRight
              className="size-4 transition group-open:rotate-90"
              aria-hidden
            />
            <Wallet className="size-4 text-accent" aria-hidden />
            Portfolio
          </span>
          <span className={`${mono} text-ink`}>
            {equity === undefined ? "—" : money(equity)}
          </span>
          <span className={`${mono} ${textColor[pnlTone ?? "none"]}`}>
            {pnl === undefined ? "" : signed(pnl)}
            {change === undefined ? "" : ` (${change})`}
          </span>
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            icon={Wallet}
            label="Equity"
            value={equity === undefined ? "—" : money(equity)}
          />
          <Stat
            icon={up ? TrendingUp : TrendingDown}
            label="Run P&L"
            value={pnl === undefined ? "—" : signed(pnl)}
            detail={change}
            tone={pnlTone}
          />
          <Stat icon={Banknote} label="Cash" value={cashLabel(book, start)} />
          <Stat
            icon={Target}
            label="Realized"
            value={book ? signed(book.realized) : "—"}
            tone={book ? signTone(book.realized) : undefined}
          />
          <Stat
            icon={Activity}
            label="Unrealized"
            value={book ? signed(book.unrealized) : "—"}
            tone={book ? signTone(book.unrealized) : undefined}
          />
          <Stat
            icon={Cpu}
            label="Model"
            value={start?.model ?? "—"}
            detail={start ? `size ${percent(start.size)} of equity` : undefined}
          />
        </div>
        {curve.length > 1 && <EquityChart values={curve} up={up} />}
      </details>
      {book && book.positions.length > 0 && <Positions book={book} />}
    </section>
  );
};

export { RunSummary };
