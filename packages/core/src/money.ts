/**
 * Money is integers (non-negotiable #3, ADR-0004).
 *
 * - Bitcoin amounts are **sats** as `bigint` (`Sats`). Never BTC, never floats.
 * - Fiat amounts are **US cents** as `bigint` (`Cents`). One currency for now; the type leaves
 *   room for a code later.
 * - A `PriceSnapshot` (cents per BTC, when, from where) is taken at decision time so every ledger
 *   row's fiat value is reproducible forever, independent of a live feed.
 */

export type Sats = bigint
export type Cents = bigint

export const SATS_PER_BTC = 100_000_000n

export class MoneyError extends Error {
  readonly code = "MONEY"
  constructor(message: string) {
    super(message)
    this.name = "MoneyError"
  }
}

/** Build a sats amount from a bigint or an integer number. Rejects negatives and non-integers. */
export function sats(n: bigint | number): Sats {
  return toInt(n, "sats")
}

/** Build a cents amount from a bigint or an integer number. Rejects negatives and non-integers. */
export function cents(n: bigint | number): Cents {
  return toInt(n, "cents")
}

function toInt(n: bigint | number, unit: string): bigint {
  let v: bigint
  if (typeof n === "number") {
    if (!Number.isSafeInteger(n)) throw new MoneyError(`${unit} must be a safe integer, got ${n}`)
    v = BigInt(n)
  } else {
    v = n
  }
  if (v < 0n) throw new MoneyError(`${unit} must not be negative, got ${v}`)
  return v
}

export interface PriceSnapshot {
  /** Integer US cents for one whole bitcoin. */
  usdCentsPerBtc: Cents
  /** ISO timestamp the price was observed. */
  asOf: string
  source: string
}

/** Fiat value of a sats amount at a snapshot, rounded DOWN (reporting never overstates). */
export function satsToCents(amount: Sats, price: PriceSnapshot): Cents {
  return (amount * price.usdCentsPerBtc) / SATS_PER_BTC
}

/** Sats you get for a cents amount at a snapshot, rounded DOWN (never promise more than bought). */
export function centsToSats(amount: Cents, price: PriceSnapshot): Sats {
  if (price.usdCentsPerBtc <= 0n) throw new MoneyError("price must be positive")
  return (amount * SATS_PER_BTC) / price.usdCentsPerBtc
}

/** "$12.34" from integer cents. */
export function formatCents(c: Cents): string {
  const whole = c / 100n // money-ok: integer bigint division for display
  const frac = c % 100n // money-ok
  return `$${whole.toLocaleString("en-US")}.${frac.toString().padStart(2, "0")}`
}

/** "21,000 sats" */
export function formatSats(s: Sats): string {
  return `${s.toLocaleString("en-US")} sats`
}
