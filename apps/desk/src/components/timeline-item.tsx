"use client";

// One row of a run's timeline: a transcript line or a ledger event.
import type { JevEvent } from "@repo/jev/ledger";
import {
  Ban,
  Camera,
  CircleCheck,
  Mic,
  Pause,
  Play,
  Square,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { TimelineItem as Item } from "~/lib/timeline";

import { audio, clock, money, percent, signed } from "./format";
import { mono, row } from "./ui";
import {
  ActionPill,
  InstrumentChip,
  instruments,
  Meter,
  SignalMeter,
} from "./visuals";

type DecisionEvent = Extract<JevEvent, { type: "decision" }>;

/** A row's time; a button that seeks the video when there is one. */
const Stamp = ({
  label,
  onSeek,
  className,
}: {
  label: string;
  onSeek: (() => void) | undefined;
  className: string;
}) => {
  if (!onSeek) {
    return <span className={className}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onSeek}
      title="Play the video from here"
      className={`group inline-flex cursor-pointer items-center gap-1 text-left hover:text-accent ${className}`}
    >
      {label}
      <Play
        className="size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden
      />
    </button>
  );
};

/** One timeline row: time, an icon on a coloured rail, then the content. */
const Row = ({
  at,
  icon: Icon,
  rail,
  tint = "",
  onSeek,
  children,
}: {
  at: string;
  icon: LucideIcon;
  rail: string;
  tint?: string;
  onSeek?: (() => void) | undefined;
  children: ReactNode;
}) => (
  <li
    className={`grid grid-cols-[5rem_1.5rem_1fr] items-start gap-2 rounded-lg border-l-2 px-2 py-1.5 wrap-anywhere ${rail} ${tint}`}
  >
    <Stamp
      label={at}
      onSeek={onSeek}
      className={`${mono} pt-0.5 text-xs text-muted`}
    />
    <Icon className="mt-0.5 size-4" aria-hidden />
    <div className="min-w-0">{children}</div>
  </li>
);

/** A decision turn: its signal and cost, then each decision or a hold. */
const DecisionBody = ({ event }: { event: DecisionEvent }) => (
  <div className="flex flex-col gap-1.5 text-ink">
    <div className={row}>
      <strong className="text-accent-2">Turn {event.turn}</strong>
      {event.signal !== null && <SignalMeter signal={event.signal} />}
      <span className={`${mono} text-xs text-muted`}>
        {event.latencyMs} ms · {event.segments} lines
        {event.usage
          ? ` · ${event.usage.inputTokens}/${event.usage.outputTokens} tok`
          : ""}
      </span>
    </div>
    {event.decisions.length === 0 ? (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
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
              <span className={`${mono} text-xs text-muted`}>
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
);

const TimelineItem = ({
  item,
  onSeek,
}: {
  item: Item;
  /** Seeks the video to a transcript time; absent without a video. */
  onSeek: ((audioTime: number) => void) | undefined;
}) => {
  if (item.kind === "segment") {
    const { start, text } = item.segment;
    return (
      <li className="grid grid-cols-[5rem_1.5rem_1fr] items-start gap-2 px-2 py-0.5 wrap-anywhere text-muted">
        <Stamp
          label={audio(start)}
          onSeek={onSeek && (() => onSeek(start))}
          className={`${mono} pt-0.5 text-xs opacity-70`}
        />
        <Mic className="mt-1 size-3 opacity-50" aria-hidden />
        <span>{text}</span>
      </li>
    );
  }
  const { event } = item;
  const at = clock(event.time);
  switch (event.type) {
    case "start": {
      return (
        <Row at={at} icon={Play} rail="border-accent text-accent">
          <span className="text-ink">
            Started <span className="font-mono">{event.source}</span> with{" "}
            <span className={mono}>{money(event.equity)}</span> equity
            {event.resumed ? " (resumed portfolio)" : ""}
          </span>
        </Row>
      );
    }
    case "decision": {
      const { audioTime } = event;
      return (
        <Row
          at={at}
          icon={Zap}
          rail="border-accent-2 text-accent-2"
          tint="bg-accent-2/5"
          onSeek={
            onSeek && audioTime !== null ? () => onSeek(audioTime) : undefined
          }
        >
          <DecisionBody event={event} />
        </Row>
      );
    }
    case "fill": {
      return (
        <Row
          at={at}
          icon={CircleCheck}
          rail="border-good text-good"
          tint="bg-good/10"
        >
          <div className="flex flex-wrap items-center gap-2 text-ink">
            <strong className="text-good">FILL</strong>
            {event.exit !== undefined && (
              <span className="text-xs font-semibold text-warn uppercase">
                {event.exit}
              </span>
            )}
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
    }
    case "reject": {
      return (
        <Row at={at} icon={Ban} rail="border-warn text-warn" tint="bg-warn/10">
          <div className="flex flex-wrap items-center gap-2 text-ink">
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
    }
    case "snapshot": {
      return (
        <Row at={at} icon={Camera} rail="border-line text-muted">
          <span className={`${mono} text-xs text-muted`}>
            equity {money(event.equity)} · cash {money(event.cash)} · exposure{" "}
            {money(event.grossExposure)}
          </span>
        </Row>
      );
    }
    case "error": {
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
    }
    case "end": {
      return (
        <Row at={at} icon={Square} rail="border-accent text-accent">
          <span className="text-ink">
            Ended ({event.reason}) with{" "}
            <span className={mono}>{money(event.equity)}</span> equity
          </span>
        </Row>
      );
    }
    default: {
      // Every event type is handled above; this only compiles while so.
      const unhandled: never = event;
      return unhandled;
    }
  }
};

export { TimelineItem };
