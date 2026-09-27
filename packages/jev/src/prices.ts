// The latest price of each instrument, with when it arrived, so a fill can
// be refused on a price that stopped updating (an ETF after the close, a feed
// that dropped).
import type { InstrumentId } from "@repo/alpaca/instruments";
import type { PriceTick } from "@repo/alpaca/prices";

import type { PriceMap } from "./portfolio";

export type LatestPrice = {
  price: number;
  source: PriceTick["source"];
  /** Exchange time of the tick. */
  timestamp: string;
  /** Engine clock when the tick arrived. */
  receivedAt: number;
};

export class PriceTable {
  private readonly latest = new Map<InstrumentId, LatestPrice>();

  update(tick: PriceTick, receivedAt: number): void {
    if (!Number.isFinite(tick.price) || tick.price <= 0) return;
    this.latest.set(tick.instrument, {
      price: tick.price,
      source: tick.source,
      timestamp: tick.timestamp,
      receivedAt,
    });
  }

  get(instrument: InstrumentId): LatestPrice | undefined {
    return this.latest.get(instrument);
  }

  /** Milliseconds since the instrument's latest tick arrived. */
  ageMs(instrument: InstrumentId, now: number): number | undefined {
    const latest = this.latest.get(instrument);
    return latest && Math.max(0, now - latest.receivedAt);
  }

  map(): PriceMap {
    const prices: PriceMap = {};
    for (const [instrument, latest] of this.latest)
      prices[instrument] = latest.price;
    return prices;
  }
}
