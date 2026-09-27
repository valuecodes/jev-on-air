import type { PriceTick } from "@repo/alpaca/prices";
import { describe, expect, it } from "vitest";

import { PriceTable } from "./prices";

const tick = (
  price: number,
  source: PriceTick["source"] = "trade"
): PriceTick => ({
  instrument: "gold",
  name: "Gold",
  symbol: "GLD",
  source,
  price,
  timestamp: "2026-09-26T12:00:00.000Z",
});

describe("PriceTable", () => {
  it("keeps the latest valid price per instrument with its age", () => {
    const table = new PriceTable();
    expect(table.get("gold")).toBeUndefined();
    expect(table.ageMs("gold", 10)).toBeUndefined();
    table.update(tick(200), 1000);
    table.update(tick(201, "quote"), 2000);
    table.update(tick(0), 3000);
    table.update(tick(NaN), 3000);
    expect(table.get("gold")).toEqual({
      price: 201,
      source: "quote",
      timestamp: "2026-09-26T12:00:00.000Z",
      receivedAt: 2000,
    });
    expect(table.ageMs("gold", 5000)).toBe(3000);
    expect(table.ageMs("gold", 1000)).toBe(0);
    expect(table.map()).toEqual({ gold: 201 });
  });
});
