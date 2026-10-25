"use client";

import type { JevEvent } from "@repo/jev/ledger";
import { useEffect, useReducer } from "react";

import type {
  LedgerLine,
  OutputLine,
  PricePoint,
  RunSummary,
  Segment,
  TranscriptLine,
} from "../lib/types";

export type StreamState = {
  ledger: LedgerLine[];
  transcript: TranscriptLine[];
  output: OutputLine[];
  /** Downsampled prices from the CLI's tick file, in time order per batch. */
  prices: PricePoint[];
  /** Desk's latest run for this id, if desk started one. */
  run: RunSummary | null;
  connected: boolean;
  notices: string[];
};

type Message =
  | { type: "ledger"; line: LedgerLine }
  | { type: "transcript"; line: TranscriptLine }
  | { type: "output"; line: OutputLine }
  | { type: "prices"; points: PricePoint[] }
  | { type: "state"; run: RunSummary }
  | { type: "reset"; file: "ledger" | "transcript" | "ticks" }
  | { type: "notice"; message: string }
  | { type: "connected"; connected: boolean };

const OUTPUT_LIMIT = 1000;
const NOTICE_LIMIT = 20;

const initial: StreamState = {
  ledger: [],
  transcript: [],
  output: [],
  prices: [],
  run: null,
  connected: false,
  notices: [],
};

function apply(state: StreamState, messages: Message[]): StreamState {
  // Copied once per batch, then appended to in place.
  let ledger = [...state.ledger];
  let transcript = [...state.transcript];
  let output = [...state.output];
  let prices = [...state.prices];
  const notices = [...state.notices];
  let { run, connected } = state;
  for (const message of messages) {
    switch (message.type) {
      case "ledger":
        ledger.push(message.line);
        break;
      case "transcript":
        transcript.push(message.line);
        break;
      case "output": {
        const last = output.at(-1);
        // A new generation means desk restarted and counts from zero again.
        if (last && last.generation !== message.line.generation)
          output = [message.line];
        else if ((last?.seq ?? 0) < message.line.seq) output.push(message.line);
        break;
      }
      case "prices":
        // A loop: spreading tens of thousands of points overflows the stack.
        for (const point of message.points) prices.push(point);
        break;
      case "state":
        run = message.run;
        break;
      case "reset":
        if (message.file === "ledger") ledger = [];
        else if (message.file === "transcript") transcript = [];
        else prices = [];
        break;
      case "notice":
        notices.push(message.message);
        break;
      case "connected":
        connected = message.connected;
        break;
    }
  }
  return {
    ledger,
    transcript,
    output: output.slice(-OUTPUT_LIMIT),
    prices,
    run,
    connected,
    notices: notices.slice(-NOTICE_LIMIT),
  };
}

type Payload<T> = { offset: number; value: T };

/**
 * Follows `/api/runs/<id>/stream`. Messages are batched per animation frame,
 * so replaying a long ledger on connect is one render, not thousands.
 */
export function useRunStream(id: string): StreamState {
  const [state, dispatch] = useReducer(apply, initial);

  useEffect(() => {
    const source = new EventSource(`/api/runs/${id}/stream`);
    let queue: Message[] = [];
    let frame: number | undefined;
    const push = (message: Message): void => {
      queue.push(message);
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        const batch = queue;
        queue = [];
        dispatch(batch);
      });
    };
    const on = (name: string, handle: (data: string) => void): void =>
      source.addEventListener(name, (event) =>
        handle((event as MessageEvent<string>).data)
      );

    on("ledger", (data) => {
      const { offset, value } = JSON.parse(data) as Payload<JevEvent>;
      push({ type: "ledger", line: { offset, event: value } });
    });
    on("transcript", (data) => {
      const { offset, value } = JSON.parse(data) as Payload<Segment>;
      push({ type: "transcript", line: { offset, segment: value } });
    });
    on("prices", (data) => {
      const { points } = JSON.parse(data) as { points: PricePoint[] };
      push({ type: "prices", points });
    });
    on("output", (data) =>
      push({ type: "output", line: JSON.parse(data) as OutputLine })
    );
    on("state", (data) =>
      push({ type: "state", run: JSON.parse(data) as RunSummary })
    );
    on("reset", (data) => {
      const { file } = JSON.parse(data) as {
        file: "ledger" | "transcript" | "ticks";
      };
      push({ type: "reset", file });
    });
    on("invalid", (data) => {
      const { file, offset } = JSON.parse(data) as {
        file: string;
        offset: number;
      };
      push({
        type: "notice",
        message: `skipped a malformed ${file} line ending at byte ${offset}`,
      });
    });
    on("notice", (data) => {
      const { message } = JSON.parse(data) as { message: string };
      push({ type: "notice", message });
    });
    source.addEventListener("open", () =>
      push({ type: "connected", connected: true })
    );
    source.addEventListener("error", () =>
      push({ type: "connected", connected: false })
    );

    return () => {
      source.close();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [id]);

  return state;
}
