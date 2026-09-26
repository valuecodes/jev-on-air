// The `prices` command: streams live prices for Jev's instruments from Alpaca
// to stdout until interrupted.
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
    const feed = new PriceFeed(this.logger, { credentials });
    for await (const tick of feed.stream(signal)) {
      process.stdout.write(
        `${args.json ? JSON.stringify(tick) : formatTick(tick)}\n`
      );
    }
  }
}
