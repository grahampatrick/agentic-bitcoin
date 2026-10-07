/**
 * Money is integers (non-negotiable #3). These are the only conversions the price feature
 * performs; everything downstream carries `usdCents` and `satsPerDollar` as integers.
 */

export const SATS_PER_BTC = 100_000_000

export class PriceParseError extends Error {
  readonly code = "PRICE_PARSE"
  constructor(message: string) {
    super(message)
    this.name = "PriceParseError"
  }
}

/** Upstreams report a decimal USD price. Convert once, at the boundary, to integer cents. */
export function usdToCents(usd: unknown): number {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    throw new PriceParseError(`invalid usd price: ${String(usd)}`)
  }
  return Math.round(usd * 100) // money-ok: the one sanctioned decimal→cents conversion
}

/** How many sats one dollar buys, rounded to the nearest whole sat. */
export function satsPerDollar(usdCents: number): number {
  if (!Number.isInteger(usdCents) || usdCents <= 0) {
    throw new PriceParseError(`invalid usdCents: ${String(usdCents)}`)
  }
  return Math.round((SATS_PER_BTC * 100) / usdCents)
}

/** "$118,432" — whole dollars, grouped. Sub-dollar precision is noise at this scale. */
export function formatUsd(usdCents: number): string {
  const dollars = Math.trunc(usdCents / 100) // money-ok: display only
  return `$${dollars.toLocaleString("en-US")}`
}

export function formatSats(n: number): string {
  return n.toLocaleString("en-US")
}
