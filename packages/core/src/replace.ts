/**
 * Replace the bitcoin you spend (M19, ADR-0022). A standing rule on the user's policy: after a
 * spend from the wallet succeeds, buy the same value back (or a percentage of it) on the user's own
 * exchange account, and optionally sweep the bought sats into the wallet. It is derived from the
 * ledger, never from a counter: a replacement is a normal `buy_bitcoin` Action whose idempotency
 * key is `replace:<ledger entry id>`, so it can happen at most once per spend, is budgeted by the
 * same policy as every other buy, and leaves the same trail. Nothing here moves money; it only
 * says which buys are due.
 */
import type { Action, BuyBitcoin, ExchangeName } from "./action"
import { isSpend, spendSats } from "./action"
import type { LedgerEntry } from "./ledger"
import { type Cents, type PriceSnapshot, centsToSats, satsToCents } from "./money"

export interface ReplaceSetting {
  enabled: boolean
  /** 1–100: how much of each spend's value to buy back. */
  percent: number
  exchange: ExchangeName
  /** Spends worth less than this (in cents) are not replaced: exchanges have minimums. */
  minUsdCents: Cents
  /** Most that replacement buys may spend in any rolling 24h, in cents. */
  dailyCapUsdCents: Cents
  /** After buying, sweep the sats into the wallet they left. */
  toWallet: boolean
  /** ISO: only spends at or after this are replaced (set when the rule is turned on). */
  since: string
}

export const DEFAULT_REPLACE: Omit<ReplaceSetting, "since"> = {
  enabled: false,
  percent: 100,
  exchange: "strike",
  minUsdCents: 100n,
  dailyCapUsdCents: 50_00n,
  toWallet: true,
}

/** A full setting from a partial one: defaults for everything not given; `since` defaults to now. */
export function replaceSetting(
  p: Partial<ReplaceSetting> = {},
  now: Date = new Date(),
): ReplaceSetting {
  return { ...DEFAULT_REPLACE, since: now.toISOString(), ...p }
}

export const REPLACE_KEY_PREFIX = "replace:"

/** The kinds that take sats OUT of the user's wallet (buys, sweeps and schedules are not spends to replace). */
const REPLACEABLE = new Set<Action["kind"]>([
  "pay_invoice",
  "pay_address",
  "buy_product",
  "pay_l402",
  "give",
])

export function isReplacement(action: Action): boolean {
  return action.kind === "buy_bitcoin" && action.idempotencyKey.startsWith(REPLACE_KEY_PREFIX)
}

export interface ReplacementDue {
  /** The spend being replaced. */
  entry: LedgerEntry
  action: BuyBitcoin
}

/**
 * Which replacement buys are due now. Pure: given the ledger, the rule and a price, returns the
 * buys to run, oldest spend first, stopping at the daily cap. A spend that already has a
 * replacement entry (any outcome, including denied or failed) is never retried: one spend, one
 * attempt, so a broken exchange does not hammer every minute.
 */
export function replacementsDue(
  entries: readonly LedgerEntry[],
  setting: ReplaceSetting,
  price: PriceSnapshot,
  now: Date,
): ReplacementDue[] {
  if (!setting.enabled) return []
  const percent = BigInt(Math.min(100, Math.max(1, Math.floor(setting.percent) || 100)))
  const attempted = new Set<string>()
  let spentTodayCents = 0n
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString()
  for (const e of entries) {
    if (!isReplacement(e.action)) continue
    attempted.add(e.action.idempotencyKey.slice(REPLACE_KEY_PREFIX.length))
    if (e.at >= dayAgo && (e.outcome === "succeeded" || e.outcome === "pending"))
      spentTodayCents += (e.action as BuyBitcoin).usdCents
  }
  const due: ReplacementDue[] = []
  const spends = entries
    .filter(
      (e) =>
        e.outcome === "succeeded" &&
        REPLACEABLE.has(e.action.kind) &&
        isSpend(e.action) &&
        e.at >= setting.since &&
        !attempted.has(e.id),
    )
    .sort((a, b) => a.at.localeCompare(b.at))
  for (const e of spends) {
    const sats = (spendSats(e.action) * percent) / 100n
    const usdCents = satsToCents(sats, price)
    if (usdCents < setting.minUsdCents) continue
    if (spentTodayCents + usdCents > setting.dailyCapUsdCents) break
    spentTodayCents += usdCents
    due.push({
      entry: e,
      action: {
        kind: "buy_bitcoin",
        exchange: setting.exchange,
        usdCents,
        estimatedSats: centsToSats(usdCents, price),
        idempotencyKey: `${REPLACE_KEY_PREFIX}${e.id}`,
        requestedBy: "schedule",
      },
    })
  }
  return due
}
