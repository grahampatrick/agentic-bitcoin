/**
 * The policy engine (ADR-0005, non-negotiable #2): `evaluate` is the only gate between an Action
 * and a rail. Pure: it takes the action, the user's policy, what the ledger says was spent in the
 * window, and a clock/price, and returns a Decision. It never touches a rail or a store.
 *
 * Order of checks is deliberate and tested: kill switch → rail enabled → deny list → allow list →
 * per-action cap → daily cap → merchant always-confirm → confirm threshold.
 */
import {
  type Action,
  actionHash,
  describeAction,
  destinationOf,
  isSpend,
  railOf,
  spendSats,
} from "./action"
import { type PriceSnapshot, type Sats, formatCents, formatSats, satsToCents } from "./money"

export interface Policy {
  /** Max sats that may leave in any rolling 24h window. */
  dailyCapSats: Sats
  /** Max sats for one action. */
  perActionCapSats: Sats
  /** Spends at or above this need a human yes. 0 = confirm everything. */
  confirmAboveSats: Sats
  /** If non-empty, only these destinations may receive money. */
  allowDestinations: readonly string[]
  /** These destinations never receive money, even if allowed. */
  denyDestinations: readonly string[]
  /** Cold-storage addresses the user registered; the ONLY places a sweep may go (ADR-0012). */
  coldStorageAddresses: readonly string[]
  /** When on, nothing moves — not even reads. */
  killSwitch: boolean
  rails: { wallet: boolean; exchange: boolean; goods: boolean; compute: boolean; onchain: boolean }
}

/** A sane starting policy: small caps, confirm anything over 10k sats, goods need a yes. */
export const DEFAULT_POLICY: Policy = {
  dailyCapSats: 100_000n,
  perActionCapSats: 50_000n,
  confirmAboveSats: 10_000n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: false, goods: true, compute: true, onchain: false },
}

export type DenyReason =
  | "KILL_SWITCH"
  | "RAIL_DISABLED"
  | "DESTINATION_DENIED"
  | "DESTINATION_NOT_ALLOWED"
  | "PER_ACTION_CAP"
  | "DAILY_CAP"
  | "MISSING_IDEMPOTENCY_KEY"
  /** A gift to a recipient that is neither a verified directory entry nor the user's own. */
  | "RECIPIENT_UNVERIFIED"

export type Decision =
  | { type: "allow"; summary: string }
  | { type: "needs_confirmation"; summary: string; actionHash: string }
  | { type: "deny"; reason: DenyReason; summary: string }

export interface LedgerWindow {
  /** Sats succeeded or in flight in the rolling window (see `spentSince`). */
  spentSats: Sats
}

export interface EvaluateContext {
  /** Price at decision time, for the fiat half of the summary. Optional for reads. */
  price?: PriceSnapshot
}

/** The window is a rolling 24 hours. */
export const WINDOW_MS = 24 * 60 * 60 * 1000

export function windowStart(now: Date): string {
  return new Date(now.getTime() - WINDOW_MS).toISOString()
}

export function evaluate(
  action: Action,
  policy: Policy,
  window: LedgerWindow,
  ctx: EvaluateContext = {},
): Decision {
  const amount = spendSats(action)
  const summary = summarize(action, amount, ctx.price)

  if (policy.killSwitch) return deny("KILL_SWITCH", summary)
  if (!policy.rails[railOf(action)]) return deny("RAIL_DISABLED", summary)

  if (!isSpend(action)) return { type: "allow", summary }

  if (!action.idempotencyKey.trim()) return deny("MISSING_IDEMPOTENCY_KEY", summary)

  const dest = destinationOf(action)
  // Gifts go only to verified directory recipients or ones the user added themselves (ADR-0013).
  if ((action.kind === "give" || action.kind === "schedule_give") && !action.verified) {
    return deny("RECIPIENT_UNVERIFIED", summary)
  }
  // Cold-storage sweeps go ONLY to an address the user registered with /cold (ADR-0012).
  if (action.kind === "sweep_to_cold" || action.kind === "schedule_sweep") {
    if (dest === null || !policy.coldStorageAddresses.some((a) => a.toLowerCase() === dest)) {
      return deny("DESTINATION_NOT_ALLOWED", summary)
    }
  } else if (dest !== null) {
    if (policy.denyDestinations.some((p) => matches(p, dest))) {
      return deny("DESTINATION_DENIED", summary)
    }
    if (
      policy.allowDestinations.length > 0 &&
      !policy.allowDestinations.some((p) => matches(p, dest))
    ) {
      return deny("DESTINATION_NOT_ALLOWED", summary)
    }
  }

  if (amount > policy.perActionCapSats) return deny("PER_ACTION_CAP", summary)
  if (window.spentSats + amount > policy.dailyCapSats) return deny("DAILY_CAP", summary)

  // Purchases from a merchant and cold-storage sweeps always need a human yes (ADR-0011, ADR-0012).
  if (
    action.kind === "buy_product" ||
    action.kind === "sweep_to_cold" ||
    action.kind === "schedule_sweep" ||
    action.kind === "schedule_give" ||
    amount >= policy.confirmAboveSats
  ) {
    return { type: "needs_confirmation", summary, actionHash: actionHash(action) }
  }
  return { type: "allow", summary }
}

function deny(reason: DenyReason, summary: string): Decision {
  return { type: "deny", reason, summary }
}

/**
 * Destination patterns: exact (case-insensitive), `*.example.com` (host suffix, also matches the
 * bare domain), or `*@example.com` (any lightning address at that domain).
 */
export function matches(pattern: string, destination: string): boolean {
  const p = pattern.trim().toLowerCase()
  const d = destination.trim().toLowerCase()
  if (!p) return false
  if (p === d) return true
  if (p.startsWith("*@")) {
    const domain = p.slice(2)
    const at = d.indexOf("@")
    return at > 0 && d.slice(at + 1) === domain
  }
  if (p.startsWith("*.")) {
    const suffix = p.slice(2)
    return d === suffix || d.endsWith(`.${suffix}`)
  }
  return false
}

/** "Pay alice@getalby.com · 21,000 sats (≈ $17.46 at $83,169/BTC)" — sats AND fiat, always. */
export function summarize(action: Action, amount: Sats, price?: PriceSnapshot): string {
  const what = describeAction(action)
  if (amount === 0n) return what
  const sats = formatSats(amount)
  if (!price) return `${what} · ${sats}`
  const fiat = formatCents(satsToCents(amount, price))
  const perBtc = formatCents(price.usdCentsPerBtc).replace(/\.\d\d$/, "")
  return `${what} · ${sats} (≈ ${fiat} at ${perBtc}/BTC)`
}
