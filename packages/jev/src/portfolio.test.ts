import { describe, expect, it } from "vitest";

import { fractionOfEquity, Portfolio } from "./portfolio";
import type { ApplyResult, PriceMap } from "./portfolio";

const prices: PriceMap = { gold: 200, bitcoin: 50_000, sp500: 500, oil: 80 };

function book(cash = 100_000, maxLeverage?: number): Portfolio {
  return new Portfolio({
    cash,
    sizer: fractionOfEquity(0.1),
    ...(maxLeverage === undefined ? {} : { maxLeverage }),
  });
}

function fill(result: ApplyResult) {
  if (result.kind !== "fill") throw new Error(`rejected: ${result.reason}`);
  return result.fill;
}

function reason(result: ApplyResult): string {
  return result.kind === "reject" ? result.reason : "filled";
}

describe("Portfolio", () => {
  it("opens and adds to a long, re-averaging the entry", () => {
    const portfolio = book();
    const first = fill(
      portfolio.apply({ instrument: "gold", action: "buy" }, prices)
    );
    expect(first).toMatchObject({
      side: "long",
      quantity: 50,
      price: 200,
      notional: 10_000,
      cash: 90_000,
    });
    const second = fill(
      portfolio.apply(
        { instrument: "gold", action: "buy" },
        { ...prices, gold: 220 }
      )
    );
    // Equity is 100 000 + 50 × 20 = 101 000, so the unit is 10 100 / 220.
    expect(second.quantity).toBeCloseTo(45.909, 3);
    const position = portfolio.position("gold");
    expect(position?.quantity).toBeCloseTo(95.909, 3);
    expect(position?.avgPrice).toBeCloseTo((10_000 + 10_100) / 95.909, 2);
  });

  it("reduces a long with sell, then exits it, realising the P&L", () => {
    const portfolio = book();
    fill(portfolio.apply({ instrument: "gold", action: "buy" }, prices));
    const reduced = fill(
      portfolio.apply({ instrument: "gold", action: "sell" }, { gold: 210 })
    );
    // One unit at 210: 10 % of equity (100 500) / 210 = 47.857 shares.
    expect(reduced.quantity).toBeCloseTo(47.857, 3);
    expect(reduced.realizedPnl).toBeCloseTo(478.57, 2);
    expect(reduced.position?.quantity).toBeCloseTo(2.143, 3);
    const exit = fill(
      portfolio.apply({ instrument: "gold", action: "sell" }, { gold: 210 })
    );
    expect(exit.quantity).toBeCloseTo(2.143, 3);
    expect(exit.position).toBeUndefined();
    expect(portfolio.markToMarket({}).realized).toBeCloseTo(500, 2);
    expect(portfolio.markToMarket({}).cash).toBeCloseTo(100_500, 2);
  });

  it("opens, adds to and closes a short", () => {
    const portfolio = book();
    const open = fill(
      portfolio.apply({ instrument: "oil", action: "short" }, prices)
    );
    expect(open).toMatchObject({ side: "short", quantity: 125, cash: 110_000 });
    fill(portfolio.apply({ instrument: "oil", action: "short" }, { oil: 80 }));
    const closed = fill(
      portfolio.apply({ instrument: "oil", action: "close" }, { oil: 70 })
    );
    expect(closed.quantity).toBeCloseTo(250, 6);
    expect(closed.realizedPnl).toBeCloseTo(2500, 2);
    expect(closed.cash).toBeCloseTo(102_500, 2);
    expect(portfolio.position("oil")).toBeUndefined();
  });

  it("rejects reversing without closing, selling shorts and closing nothing", () => {
    const portfolio = book();
    fill(portfolio.apply({ instrument: "gold", action: "buy" }, prices));
    fill(portfolio.apply({ instrument: "oil", action: "short" }, prices));
    expect(
      reason(portfolio.apply({ instrument: "gold", action: "short" }, prices))
    ).toBe("long open; close first");
    expect(
      reason(portfolio.apply({ instrument: "oil", action: "buy" }, prices))
    ).toBe("short open; close first");
    expect(
      reason(portfolio.apply({ instrument: "oil", action: "sell" }, prices))
    ).toBe("short open; use close");
    expect(
      reason(portfolio.apply({ instrument: "sp500", action: "sell" }, prices))
    ).toBe("no long to sell");
    expect(
      reason(portfolio.apply({ instrument: "sp500", action: "close" }, prices))
    ).toBe("no position to close");
  });

  it("rejects fills without a price, with a bad price or beyond the exposure cap", () => {
    const portfolio = book(100_000, 0.25);
    expect(
      reason(portfolio.apply({ instrument: "gold", action: "buy" }, {}))
    ).toBe("no price yet for gold");
    expect(
      reason(
        portfolio.apply({ instrument: "gold", action: "buy" }, { gold: 0 })
      )
    ).toBe("invalid price 0");
    fill(portfolio.apply({ instrument: "gold", action: "buy" }, prices));
    fill(portfolio.apply({ instrument: "oil", action: "short" }, prices));
    expect(
      reason(portfolio.apply({ instrument: "sp500", action: "buy" }, prices))
    ).toMatch(/^exposure 30000\.00 would exceed 25000\.00/);
    // Closing is always allowed.
    expect(
      reason(portfolio.apply({ instrument: "oil", action: "close" }, prices))
    ).toBe("filled");
  });

  it("rejects entries when equity is gone or cash is short", () => {
    const portfolio = book(1000);
    fill(portfolio.apply({ instrument: "oil", action: "short" }, prices));
    // Oil at 1000: the short of 1.25 barrels is 1250 under water, equity < 0.
    expect(
      reason(
        portfolio.apply(
          { instrument: "gold", action: "buy" },
          { ...prices, oil: 1000 }
        )
      )
    ).toBe("equity is not positive");
    expect(
      reason(
        portfolio.apply(
          { instrument: "oil", action: "close" },
          { ...prices, oil: 1000 }
        )
      )
    ).toBe("filled");
    // A sell reduces risk, so it still goes through: the whole long, since
    // a unit cannot be sized without equity.
    const underwater = book(1000);
    fill(underwater.apply({ instrument: "gold", action: "buy" }, prices));
    fill(underwater.apply({ instrument: "oil", action: "short" }, prices));
    const sold = fill(
      underwater.apply(
        { instrument: "gold", action: "sell" },
        { gold: 100, oil: 1000 }
      )
    );
    expect(sold.quantity).toBeCloseTo(0.5, 6);
    expect(sold.position).toBeUndefined();
    const poor = new Portfolio({ cash: 100, sizer: () => 10 });
    expect(
      reason(poor.apply({ instrument: "gold", action: "buy" }, prices))
    ).toBe("insufficient cash");
    const zero = new Portfolio({ cash: 100, sizer: () => 0 });
    expect(
      reason(zero.apply({ instrument: "gold", action: "buy" }, prices))
    ).toBe("zero quantity");
  });

  it("marks a mixed book to market and keeps equity through a fill", () => {
    const portfolio = book();
    fill(portfolio.apply({ instrument: "gold", action: "buy" }, prices));
    fill(portfolio.apply({ instrument: "oil", action: "short" }, prices));
    const before = portfolio.markToMarket({ gold: 210, oil: 70 });
    expect(before).toMatchObject({ cash: 100_000, realized: 0 });
    expect(before.unrealized).toBeCloseTo(500 + 1250, 2);
    expect(before.equity).toBeCloseTo(101_750, 2);
    expect(before.grossExposure).toBeCloseTo(50 * 210 + 125 * 70, 2);
    expect(before.positions.map((p) => p.instrument)).toEqual(["gold", "oil"]);
    // An unpriced position marks at its entry price.
    expect(portfolio.markToMarket({}).unrealized).toBe(0);
    fill(
      portfolio.apply(
        { instrument: "sp500", action: "buy" },
        { gold: 210, oil: 70, sp500: 500 }
      )
    );
    expect(
      portfolio.markToMarket({ gold: 210, oil: 70, sp500: 500 }).equity
    ).toBeCloseTo(101_750, 2);
  });

  it("round-trips through state", () => {
    const portfolio = book();
    fill(portfolio.apply({ instrument: "gold", action: "buy" }, prices));
    fill(
      portfolio.apply({ instrument: "gold", action: "sell" }, { gold: 210 })
    );
    const state = portfolio.toState("2026-09-26T12:00:00.000Z", "run-1");
    expect(state).toMatchObject({
      version: 1,
      updatedAt: "2026-09-26T12:00:00.000Z",
      lastRun: "run-1",
    });
    const restored = Portfolio.fromState(state, {
      sizer: fractionOfEquity(0.1),
    });
    expect(restored.markToMarket(prices)).toEqual(
      portfolio.markToMarket(prices)
    );
    expect(restored.toState("t")).toEqual({
      ...state,
      updatedAt: "t",
      lastRun: undefined,
    });
  });
});
