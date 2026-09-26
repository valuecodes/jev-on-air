// The markets Jev watches. Alpaca has no spot metals, commodities or index
// futures, so gold, oil and the S&P 500 are tracked through the most liquid
// ETF for each — tradable on Alpaca, so a signal can later be paper-traded on
// exactly the symbol it was priced from.

export type InstrumentId = "gold" | "bitcoin" | "sp500" | "oil";

/** Which Alpaca stream carries the symbol. */
export type Market = "stocks" | "crypto";

export type Instrument = {
  id: InstrumentId;
  name: string;
  /** Alpaca symbol: a ticker for stocks, a `BASE/QUOTE` pair for crypto. */
  symbol: string;
  market: Market;
};

export const INSTRUMENTS: readonly Instrument[] = [
  { id: "gold", name: "Gold", symbol: "GLD", market: "stocks" },
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC/USD", market: "crypto" },
  { id: "sp500", name: "S&P 500", symbol: "SPY", market: "stocks" },
  { id: "oil", name: "Oil", symbol: "USO", market: "stocks" },
];

/** The instrument priced by `symbol`, if it is one of ours. */
export function instrumentForSymbol(symbol: string): Instrument | undefined {
  return INSTRUMENTS.find((instrument) => instrument.symbol === symbol);
}
