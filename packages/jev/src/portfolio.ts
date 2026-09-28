// The simulated book: cash and one position per instrument, with fills sized
// as a fraction of equity. Pure and synchronous; persistence and pricing live
// elsewhere. Quantities are fractional, since nothing here is a real order.
import type { InstrumentId } from "@repo/alpaca/instruments";

import type { Action } from "./schema";
import type { PortfolioState } from "./state";

export type Side = "long" | "short";

export type Position = {
  side: Side;
  quantity: number;
  /** Volume-weighted average entry price. */
  avgPrice: number;
};

/** Latest price per instrument, in USD. */
export type PriceMap = Partial<Record<InstrumentId, number>>;

export type Order = { instrument: InstrumentId; action: Action };

export type Fill = {
  instrument: InstrumentId;
  action: Action;
  side: Side;
  quantity: number;
  price: number;
  /** `quantity × price`. */
  notional: number;
  /** Profit realised by this fill; zero when opening or adding. */
  realizedPnl: number;
  /** The position after the fill, if any is left. */
  position: Position | undefined;
  /** Cash after the fill. */
  cash: number;
};

export type ApplyResult =
  { kind: "fill"; fill: Fill } | { kind: "reject"; reason: string };

export type PositionView = Position & {
  instrument: InstrumentId;
  /** Mark price; the average price when the instrument has no price yet. */
  price: number;
  unrealizedPnl: number;
};

export type Snapshot = {
  cash: number;
  equity: number;
  realized: number;
  unrealized: number;
  /** Sum of the absolute market value of every position. */
  grossExposure: number;
  positions: PositionView[];
};

/**
 * Quantity to open or add for a fill at `price` with the given equity.
 * `volatility` is the instrument's one-minute volatility in percent, when
 * known.
 */
export type Sizer = (input: {
  equity: number;
  price: number;
  volatility?: number;
}) => number;

/** Sizes every fill to `fraction` of current equity. */
export function fractionOfEquity(fraction: number): Sizer {
  return ({ equity, price }) => (fraction * equity) / price;
}

export type VolatilityScaledOptions = {
  /** Fraction of equity per fill when volatility is unknown. */
  fraction: number;
  /** Fraction of equity a one-sigma 15-minute move should cost. */
  risk: number;
};

// A fill is kept between these multiples of the fixed-fraction size, so a
// calm quarter-hour cannot lever the book up, nor a wild one shrink it to dust.
const minScale = 0.25;
const maxScale = 2;

/**
 * Sizes each fill so a usual 15-minute move (`volatility·√15`) costs `risk`
 * of equity: quiet markets get more, wild ones less, within 0.25× to 2× of
 * `fraction`. Without a volatility it sizes like `fractionOfEquity`.
 */
export function volatilityScaled(options: VolatilityScaledOptions): Sizer {
  const { fraction, risk } = options;
  return ({ equity, price, volatility }) => {
    const base = fraction * equity;
    if (volatility === undefined || !(volatility > 0)) return base / price;
    const move = (volatility * Math.sqrt(15)) / 100;
    const notional = Math.min(
      maxScale * base,
      Math.max(minScale * base, (risk * equity) / move)
    );
    return notional / price;
  };
}

export type PortfolioOptions = {
  cash: number;
  sizer: Sizer;
  /**
   * Cap on gross exposure as a multiple of equity (default 1: no leverage).
   */
  maxLeverage?: number;
};

// Below this a position is flat: float noise from reducing a long to zero.
const dust = 1e-9;

export class Portfolio {
  private cash: number;
  private realized: number;
  private readonly positions = new Map<InstrumentId, Position>();
  private readonly sizer: Sizer;
  private readonly maxLeverage: number;

  constructor(options: PortfolioOptions) {
    this.cash = options.cash;
    this.realized = 0;
    this.sizer = options.sizer;
    this.maxLeverage = options.maxLeverage ?? 1;
  }

  /** Restores a book saved with `toState`. */
  static fromState(
    state: PortfolioState,
    options: Omit<PortfolioOptions, "cash">
  ): Portfolio {
    const portfolio = new Portfolio({ ...options, cash: state.cash });
    portfolio.realized = state.realized;
    for (const [instrument, position] of Object.entries(state.positions))
      if (position)
        portfolio.positions.set(instrument as InstrumentId, { ...position });
    return portfolio;
  }

  toState(updatedAt: string, lastRun?: string): PortfolioState {
    const positions: PortfolioState["positions"] = {};
    for (const [instrument, position] of this.positions)
      positions[instrument] = { ...position };
    return {
      version: 1,
      cash: this.cash,
      realized: this.realized,
      positions,
      updatedAt,
      ...(lastRun === undefined ? {} : { lastRun }),
    };
  }

  position(instrument: InstrumentId): Position | undefined {
    const position = this.positions.get(instrument);
    return position ? { ...position } : undefined;
  }

  markToMarket(prices: PriceMap): Snapshot {
    let unrealized = 0;
    let grossExposure = 0;
    let longValue = 0;
    let shortValue = 0;
    const positions: PositionView[] = [];
    for (const [instrument, position] of this.positions) {
      const price = prices[instrument] ?? position.avgPrice;
      const value = position.quantity * price;
      const unrealizedPnl =
        position.side === "long"
          ? (price - position.avgPrice) * position.quantity
          : (position.avgPrice - price) * position.quantity;
      unrealized += unrealizedPnl;
      grossExposure += value;
      if (position.side === "long") longValue += value;
      else shortValue += value;
      positions.push({ ...position, instrument, price, unrealizedPnl });
    }
    return {
      cash: this.cash,
      equity: this.cash + longValue - shortValue,
      realized: this.realized,
      unrealized,
      grossExposure,
      positions,
    };
  }

  /**
   * Fills `order` at the instrument's price in `prices`, or explains why not.
   * `buy` opens or adds to a long, `short` opens or adds to a short, `sell`
   * reduces a long by one sizing unit and `close` flattens either side.
   * Reversing is two steps: the opposite side must be closed first.
   * `volatility` reaches the sizer, for volatility-scaled books.
   */
  apply(order: Order, prices: PriceMap, volatility?: number): ApplyResult {
    const { instrument, action } = order;
    const price = prices[instrument];
    if (price === undefined)
      return { kind: "reject", reason: `no price yet for ${instrument}` };
    if (!Number.isFinite(price) || price <= 0)
      return { kind: "reject", reason: `invalid price ${price}` };

    const position = this.positions.get(instrument);
    if (action === "close") {
      if (!position) return { kind: "reject", reason: "no position to close" };
      return this.reduce(
        instrument,
        position,
        position.quantity,
        price,
        action
      );
    }

    const { equity, grossExposure } = this.markToMarket(prices);
    const size = equity > 0 ? this.sizer({ equity, price, volatility }) : NaN;
    const sized = Number.isFinite(size) && size > 0;

    if (action === "sell") {
      if (!position) return { kind: "reject", reason: "no long to sell" };
      if (position.side === "short")
        return { kind: "reject", reason: "short open; use close" };
      // Selling reduces risk, so it is allowed even when equity is gone: the
      // whole position goes when a unit cannot be sized.
      const quantity = sized
        ? Math.min(size, position.quantity)
        : position.quantity;
      return this.reduce(instrument, position, quantity, price, action);
    }

    if (!(equity > 0))
      return { kind: "reject", reason: "equity is not positive" };
    if (!sized) return { kind: "reject", reason: "zero quantity" };

    const side: Side = action === "buy" ? "long" : "short";
    if (position && position.side !== side)
      return {
        kind: "reject",
        reason: `${position.side} open; close first`,
      };
    const notional = size * price;
    if (side === "long" && notional > this.cash)
      return { kind: "reject", reason: "insufficient cash" };
    if (grossExposure + notional > equity * this.maxLeverage)
      return {
        kind: "reject",
        reason: `exposure ${(grossExposure + notional).toFixed(2)} would exceed ${(equity * this.maxLeverage).toFixed(2)}`,
      };

    const quantity = (position?.quantity ?? 0) + size;
    const avgPrice = position
      ? (position.avgPrice * position.quantity + notional) / quantity
      : price;
    const next = { side, quantity, avgPrice };
    this.positions.set(instrument, next);
    this.cash += side === "long" ? -notional : notional;
    return {
      kind: "fill",
      fill: {
        instrument,
        action,
        side,
        quantity: size,
        price,
        notional,
        realizedPnl: 0,
        position: { ...next },
        cash: this.cash,
      },
    };
  }

  private reduce(
    instrument: InstrumentId,
    position: Position,
    quantity: number,
    price: number,
    action: Action
  ): ApplyResult {
    const notional = quantity * price;
    const realizedPnl =
      position.side === "long"
        ? (price - position.avgPrice) * quantity
        : (position.avgPrice - price) * quantity;
    this.cash += position.side === "long" ? notional : -notional;
    this.realized += realizedPnl;
    const remaining = position.quantity - quantity;
    let next: Position | undefined;
    if (remaining > dust) {
      next = { ...position, quantity: remaining };
      this.positions.set(instrument, next);
    } else {
      this.positions.delete(instrument);
    }
    return {
      kind: "fill",
      fill: {
        instrument,
        action,
        side: position.side,
        quantity,
        price,
        notional,
        realizedPnl,
        position: next ? { ...next } : undefined,
        cash: this.cash,
      },
    };
  }
}
