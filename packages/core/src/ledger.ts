/**
 * The ledger: every action attempted, decided, and resolved — append-only.
 *
 * The store holds *events*; an `LedgerEntry` is the fold of the events for one action id. Nothing
 * is ever updated in place, so an audit can replay history and the daily budget is computed from
 * the window, not from a counter that restarts reset.
 */
import type { Action } from "./action"
import type { Decision } from "./policy"

export type Outcome = "awaiting_confirmation" | "denied" | "pending" | "succeeded" | "failed"

export type LedgerEvent =
  | { type: "requested"; id: string; at: string; action: Action; decision: Decision }
  | { type: "started"; id: string; at: string }
  | { type: "succeeded"; id: string; at: string; preimage?: string; detail?: string }
  | { type: "failed"; id: string; at: string; error: string }

export interface LedgerEntry {
  id: string
  /** When the action was requested. */
  at: string
  action: Action
  decision: Decision
  outcome: Outcome
  preimage?: string
  detail?: string
  error?: string
  /** When the final outcome was recorded, if any. */
  resolvedAt?: string
}

export interface LedgerStore {
  readonly kind: string
  append(event: LedgerEvent): Promise<void>
  /** All events, oldest first. `since` filters by event time (ISO), inclusive. */
  events(since?: string): Promise<readonly LedgerEvent[]>
}

/** Fold events into entries, keyed by action id, oldest request first. */
export function foldEntries(events: readonly LedgerEvent[]): LedgerEntry[] {
  const byId = new Map<string, LedgerEntry>()
  for (const ev of events) {
    if (ev.type === "requested") {
      byId.set(ev.id, {
        id: ev.id,
        at: ev.at,
        action: ev.action,
        decision: ev.decision,
        outcome:
          ev.decision.type === "deny"
            ? "denied"
            : ev.decision.type === "needs_confirmation"
              ? "awaiting_confirmation"
              : "pending",
      })
      continue
    }
    const e = byId.get(ev.id)
    if (!e) continue // an orphan event; keep folding, never throw inside an audit
    if (ev.type === "started") e.outcome = "pending"
    if (ev.type === "succeeded") {
      e.outcome = "succeeded"
      e.preimage = ev.preimage
      e.detail = ev.detail
      e.resolvedAt = ev.at
    }
    if (ev.type === "failed") {
      e.outcome = "failed"
      e.error = ev.error
      e.resolvedAt = ev.at
    }
  }
  return [...byId.values()]
}

/** Sum of sats that left (or are in flight) for entries requested at or after `since`. */
export function spentSince(entries: readonly LedgerEntry[], since: string): bigint {
  let total = 0n
  for (const e of entries) {
    if (e.at < since) continue
    if (e.outcome !== "succeeded" && e.outcome !== "pending") continue
    total += spendOf(e.action)
  }
  return total
}

function spendOf(action: Action): bigint {
  switch (action.kind) {
    case "pay_invoice":
    case "pay_address":
    case "buy_product":
    case "pay_l402":
      return action.amountSats
    case "buy_bitcoin":
    case "schedule_buy":
      return action.estimatedSats
    default:
      return 0n
  }
}

/** The entry for an idempotency key, if that key was ever requested. */
export function findByIdempotencyKey(
  entries: readonly LedgerEntry[],
  key: string,
): LedgerEntry | undefined {
  return entries.find((e) => e.action.idempotencyKey === key)
}

/** In-memory store: per-process, non-durable. The fallback for dev, CI and the unit suite. */
export class InMemoryLedgerStore implements LedgerStore {
  readonly kind = "memory"
  private readonly log: LedgerEvent[] = []

  append(event: LedgerEvent): Promise<void> {
    this.log.push(event)
    return Promise.resolve()
  }

  events(since?: string): Promise<readonly LedgerEvent[]> {
    return Promise.resolve(since ? this.log.filter((e) => e.at >= since) : [...this.log])
  }
}

/** Convenience: fold a store's events into entries. */
export async function readEntries(store: LedgerStore): Promise<LedgerEntry[]> {
  return foldEntries(await store.events())
}
