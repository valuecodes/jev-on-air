// The `prices` command: streams live prices for Jev's instruments from Alpaca
// to stdout until interrupted, or prints a past window of them.
import { once } from "node:events";
import { PriceHistory } from "@repo/alpaca/history";
import { PriceFeed } from "@repo/alpaca/prices";
import type { LoggerLike } from "@repo/logger";

import { formatTick } from "./cli";
import type { AlpacaCredentials, PricesArgs } from "./cli";

export class PricesCommand {
  private readonly logger: LoggerLike;

  constructor(logger: LoggerLike) {
    this.logger = logger;
  }

  async run(
    args: PricesArgs,
    credentials: AlpacaCredentials,
    signal?: AbortSignal
  ): Promise<void> {
    const ticks = args.history
      ? new PriceHistory(this.logger, {
          credentials,
          barMinutes: args.history.barMinutes,
          stockFeed: args.history.feed,
        }).ticks(args.history, signal)
      : new PriceFeed(this.logger, { credentials }).stream(signal);
    for await (const tick of ticks) {
      const line = `${args.json ? JSON.stringify(tick) : formatTick(tick)}\n`;
      // Wait out a slow pipe rather than queueing output in memory.
      if (!process.stdout.write(line)) await once(process.stdout, "drain");
    }
  }
}
