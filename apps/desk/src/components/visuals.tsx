// The desk's visual vocabulary: a colour and icon per instrument and action,
// and small meters. Colour is never the only signal: each keeps its label.
import type { Decision } from "@repo/jev/schema";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  ChartLine,
  Coins,
  Droplet,
  TrendingDown,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { mono } from "./ui";

type Instrument = Decision["instrument"];
type Action = Decision["action"];

type Look = {
  name: string;
  icon: LucideIcon;
  chip: string;
  bar: string;
};

const instruments: Record<Instrument, Look> = {
  gold: {
    name: "Gold",
    icon: Coins,
    chip: "border-gold/40 bg-gold/10 text-gold",
    bar: "bg-gold",
  },
  bitcoin: {
    name: "Bitcoin",
    icon: Bitcoin,
    chip: "border-bitcoin/40 bg-bitcoin/10 text-bitcoin",
    bar: "bg-bitcoin",
  },
  sp500: {
    name: "S&P 500",
    icon: ChartLine,
    chip: "border-sp500/40 bg-sp500/10 text-sp500",
    bar: "bg-sp500",
  },
  oil: {
    name: "Oil",
    icon: Droplet,
    chip: "border-oil/40 bg-oil/10 text-oil",
    bar: "bg-oil",
  },
};

const actions: Record<Action, Look> = {
  buy: {
    name: "Buy",
    icon: ArrowUpRight,
    chip: "border-buy/50 bg-buy/15 text-buy",
    bar: "bg-buy",
  },
  sell: {
    name: "Sell",
    icon: ArrowDownRight,
    chip: "border-sell/50 bg-sell/15 text-sell",
    bar: "bg-sell",
  },
  short: {
    name: "Short",
    icon: TrendingDown,
    chip: "border-short/50 bg-short/15 text-short",
    bar: "bg-short",
  },
  close: {
    name: "Close",
    icon: X,
    chip: "border-close/50 bg-close/15 text-close",
    bar: "bg-close",
  },
};

const pill =
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold";

const InstrumentChip = ({ id }: { id: Instrument }) => {
  const { name, icon: Icon, chip } = instruments[id];
  return (
    <span className={`${pill} ${chip}`}>
      <Icon className="size-3.5" aria-hidden />
      {name}
    </span>
  );
};

const ActionPill = ({ action }: { action: Action }) => {
  const { name, icon: Icon, chip } = actions[action];
  return (
    <span className={`${pill} ${chip} tracking-wider uppercase`}>
      <Icon className="size-3.5" aria-hidden />
      {name}
    </span>
  );
};

/** A thin bar filled to `value` (0–1), with the percentage beside it. */
const Meter = ({
  value,
  fill,
  label,
}: {
  value: number;
  fill: string;
  label?: string;
}) => {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="inline-flex items-center gap-2">
      {label !== undefined && label !== "" && (
        <span className="text-xs text-muted">{label}</span>
      )}
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
        <span
          className={`block h-full rounded-full ${fill}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className={`${mono} text-xs`}>{percent}%</span>
    </span>
  );
};

/** Gray, then amber, then green as the signal grows. */
const signalFill = (signal: number): string => {
  if (signal >= 0.5) {
    return "bg-good shadow-[0_0_8px_var(--color-good)]";
  }
  if (signal >= 0.25) {
    return "bg-warn";
  }
  return "bg-muted";
};

/** How likely the new lines moved a market. */
const SignalMeter = ({ signal }: { signal: number }) => (
  <Meter value={signal} fill={signalFill(signal)} label="signal" />
);

/** A pulsing dot for anything live. */
const LiveDot = ({ tone = "good" }: { tone?: "good" | "bad" }) => (
  <span
    className={`inline-block size-2 animate-glow rounded-full ${tone === "good" ? "bg-good text-good" : "bg-bad text-bad"}`}
    aria-hidden
  />
);

export { ActionPill, InstrumentChip, instruments, LiveDot, Meter, SignalMeter };
