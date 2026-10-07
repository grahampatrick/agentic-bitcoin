/**
 * Upstream price sources. Each parser takes the raw JSON and returns integer cents or throws
 * {@link PriceParseError}. Fetching lives in `feed.ts`; parsing stays pure for tests.
 */
import { PriceParseError, usdToCents } from "./money"

export type PriceSource = "mempool.space" | "coingecko"

export interface SourceDef {
  readonly name: PriceSource
  readonly url: string
  readonly parse: (json: unknown) => number
}

/** mempool.space: `{ time: 1700000000, USD: 118432, EUR: ... }` — USD is already whole dollars. */
export function parseMempool(json: unknown): number {
  const usd = (json as { USD?: unknown })?.USD
  if (typeof usd !== "number") throw new PriceParseError("mempool.space: missing USD")
  return usdToCents(usd)
}

/** CoinGecko: `{ bitcoin: { usd: 118432.17 } }`. */
export function parseCoinGecko(json: unknown): number {
  const usd = (json as { bitcoin?: { usd?: unknown } })?.bitcoin?.usd
  if (typeof usd !== "number") throw new PriceParseError("coingecko: missing bitcoin.usd")
  return usdToCents(usd)
}

export const DEFAULT_SOURCES: readonly SourceDef[] = [
  {
    name: "mempool.space",
    url: process.env.PRICE_PRIMARY_URL ?? "https://mempool.space/api/v1/prices",
    parse: parseMempool,
  },
  {
    name: "coingecko",
    url:
      process.env.PRICE_FALLBACK_URL ??
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    parse: parseCoinGecko,
  },
]
