/**
 * Virtual Lightning cards (M17a, ADR-0021): a card is a POLICY on the user's own wallet, never a
 * balance. It has a name, a scope (what it may pay), a monthly cap that resets on a day of the month,
 * optional per-action and confirm thresholds, and a state. A spend that matches a card's scope is
 * tagged with the card id in the ledger and must fit the card's budget on top of the user's policy.
 * Funds never move into a card; closing one changes nothing about the user's wallet.
 */
import { type Action, isSpend, spendSats } from "./action"
import type { LedgerEntry } from "./ledger"
import type { Sats } from "./money"
import { matches } from "./policy"

export type CardState = "active" | "paused" | "closed"

export interface VirtualCard {
  /** `card_…` */
  id: string
  userId: string
  /** Human name: "Steam purchases". */
  name: string
  /**
   * What the card pays. Any pattern matching makes the card apply:
   * `*` (every spend) · a Lightning address or `*@domain` · `host` / `*.host` (L402) ·
   * `merchant:bitrefill` · `shop:<slug>` (a directory merchant) · `product:<text>` (product id or
   * description contains text) · `rail:<wallet|exchange|goods|compute|onchain>` · `kind:<action kind>`.
   */
  scope: readonly string[]
  monthlyCapSats: Sats
  /** Caps a single spend on this card; the user's own per-action cap still applies. */
  perActionCapSats?: Sats
  /** Spends at or above this need a yes; overrides the user's threshold for this card only. */
  confirmAboveSats?: Sats
  /** Day of month (1–28, UTC) when the monthly budget resets. */
  resetDay: number
  state: CardState
  createdAt: string
  /** sha256 of the token that opens the card's web page; the token itself is shown once. */
  viewTokenHash?: string
  /** Display snapshot, refreshed after each spend (the ledger is the source of truth). */
  spentSats?: Sats
  periodStart?: string
}

export interface CardStore {
  readonly kind: string
  get(id: string): Promise<VirtualCard | null>
  listForUser(userId: string): Promise<VirtualCard[]>
  create(c: VirtualCard): Promise<void>
  update(c: VirtualCard): Promise<void>
}

export const CARD_NAME_MAX = 60
export const MAX_CARDS_PER_USER = 20

export class CardError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND" | "LIMIT",
    message: string,
  ) {
    super(message)
    this.name = "CardError"
  }
}

/** The latest reset at or before `now`, as ISO. */
export function periodStart(card: Pick<VirtualCard, "resetDay">, now: Date): string {
  const day = Math.min(28, Math.max(1, Math.floor(card.resetDay) || 1))
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const thisMonth = Date.UTC(y, m, day)
  const start = now.getTime() >= thisMonth ? thisMonth : Date.UTC(y, m - 1, day)
  return new Date(start).toISOString()
}

/** The next reset after `now`, as ISO (for "resets on …" copy). */
export function periodEnd(card: Pick<VirtualCard, "resetDay">, now: Date): string {
  const start = new Date(periodStart(card, now))
  return new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()),
  ).toISOString()
}

const RAILS = new Set(["wallet", "exchange", "goods", "compute", "onchain"])

export function normalizeScope(raw: readonly string[]): string[] {
  const out: string[] = []
  for (const r of raw) {
    const p = r.trim().toLowerCase()
    if (!p || p.length > 120) continue
    if (p.startsWith("rail:") && !RAILS.has(p.slice(5)))
      throw new CardError("INVALID", `unknown rail in scope: ${p}`)
    if (p.startsWith("product:") && p.length < 10)
      throw new CardError("INVALID", "product: scope needs at least two characters")
    if (!out.includes(p)) out.push(p)
  }
  if (!out.length) throw new CardError("INVALID", "a card needs a scope: what may it pay?")
  return out
}

/** Does one scope pattern cover this action? Reads never match. */
export function scopeMatches(pattern: string, action: Action): boolean {
  if (!isSpend(action)) return false
  const p = pattern.trim().toLowerCase()
  if (p === "*") return true
  if (p.startsWith("kind:")) return action.kind === p.slice(5)
  if (p.startsWith("rail:")) return railOfKind(action.kind) === p.slice(5)
  if (p.startsWith("merchant:"))
    return action.kind === "buy_product" && action.merchant === p.slice(9)
  if (p.startsWith("shop:"))
    return (
      action.kind === "buy_product" &&
      action.productId.toLowerCase().startsWith(`dir:${p.slice(5)}:`)
    )
  if (p.startsWith("product:")) {
    if (action.kind !== "buy_product") return false
    const needle = p.slice(8)
    return (
      action.productId.toLowerCase().includes(needle) ||
      action.description.toLowerCase().includes(needle)
    )
  }
  const dest = destinationText(action)
  return dest !== null && matches(p, dest)
}

function destinationText(action: Action): string | null {
  switch (action.kind) {
    case "pay_address":
    case "give":
    case "schedule_give":
      return action.address.toLowerCase()
    case "pay_invoice":
      return action.destination?.toLowerCase() ?? null
    case "pay_l402":
      return action.host.toLowerCase()
    default:
      return null
  }
}

function railOfKind(kind: Action["kind"]): string {
  switch (kind) {
    case "buy_bitcoin":
    case "schedule_buy":
    case "cancel_schedule":
      return "exchange"
    case "buy_product":
    case "search_products":
      return "goods"
    case "pay_l402":
      return "compute"
    case "sweep_to_cold":
    case "schedule_sweep":
      return "onchain"
    default:
      return "wallet"
  }
}

/** The card a spend lands on: the oldest open (active or paused) card whose scope matches. */
export function cardFor(action: Action, cards: readonly VirtualCard[]): VirtualCard | null {
  if (!isSpend(action)) return null
  const open = cards
    .filter((c) => c.state !== "closed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return open.find((c) => c.scope.some((p) => scopeMatches(p, action))) ?? null
}

/** Sats succeeded or in flight on this card since `since` (the current period). */
export function cardSpentSince(
  entries: readonly LedgerEntry[],
  cardId: string,
  since: string,
): Sats {
  let total = 0n
  for (const e of entries) {
    if (e.at < since || e.action.cardId !== cardId) continue
    if (e.outcome !== "succeeded" && e.outcome !== "pending") continue
    total += spendSats(e.action)
  }
  return total
}

/** What a new card needs; the executor's `create_card` and the web form both go through `buildCard`. */
export interface NewCardInput {
  name: string
  scope: readonly string[]
  monthlyCapSats: Sats
  perActionCapSats?: Sats
  confirmAboveSats?: Sats
  resetDay: number
}

/**
 * The one way to make a card: validates the name, scope, caps and reset day against the user's
 * existing cards and returns the record to store (throws `CardError`, never stores).
 */
export function buildCard(
  input: NewCardInput,
  userId: string,
  existing: readonly VirtualCard[],
  now: Date,
  viewTokenHash?: string,
): VirtualCard {
  const open = existing.filter((c) => c.state !== "closed")
  if (open.length >= MAX_CARDS_PER_USER)
    throw new CardError("LIMIT", `you already have ${MAX_CARDS_PER_USER} cards; close one first`)
  const name = input.name.trim().slice(0, CARD_NAME_MAX)
  if (!name) throw new CardError("INVALID", "a card needs a name")
  if (open.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    throw new CardError("INVALID", `you already have a card called “${name}”`)
  if (input.monthlyCapSats < 1n)
    throw new CardError("INVALID", "the monthly limit must be at least 1 sat")
  if (input.perActionCapSats !== undefined && input.perActionCapSats < 1n)
    throw new CardError("INVALID", "the per-payment limit must be at least 1 sat")
  if (input.confirmAboveSats !== undefined && input.confirmAboveSats < 0n)
    throw new CardError("INVALID", "the ask-me-above threshold cannot be negative")
  const resetDay = Math.min(28, Math.max(1, Math.floor(input.resetDay) || 1))
  return {
    id: newCardId(now, existing.length + 1),
    userId,
    name,
    scope: normalizeScope(input.scope),
    monthlyCapSats: input.monthlyCapSats,
    perActionCapSats: input.perActionCapSats,
    confirmAboveSats: input.confirmAboveSats,
    resetDay,
    state: "active",
    createdAt: now.toISOString(),
    viewTokenHash,
    spentSats: 0n,
    periodStart: periodStart({ resetDay }, now),
  }
}

/**
 * A card made on the web before the person has a chat identity is owned by `web:<random>`; it
 * enforces nothing until claimed from chat (`/cards claim <id> <token>`), which moves it under the
 * chat user. The claim token is the card's view token, so the person who holds the link owns it.
 */
export const WEB_OWNER_PREFIX = "web:"

export function isUnclaimed(card: Pick<VirtualCard, "userId">): boolean {
  return card.userId.startsWith(WEB_OWNER_PREFIX)
}

export type ClaimResult =
  | { ok: true; card: VirtualCard }
  | { ok: false; code: "NOT_FOUND" | "NOT_AUTHORIZED" | "ALREADY_CLAIMED" | "LIMIT" | "NAME" }

/** Moves an unclaimed web card under `userId` when `tokenHash` matches its view token. */
export async function claimCard(
  store: CardStore,
  id: string,
  tokenHash: string,
  userId: string,
): Promise<ClaimResult> {
  const c = await store.get(id)
  if (!c || c.state === "closed") return { ok: false, code: "NOT_FOUND" }
  if (!c.viewTokenHash || c.viewTokenHash !== tokenHash)
    return { ok: false, code: "NOT_AUTHORIZED" }
  if (c.userId === userId) return { ok: true, card: c }
  if (!isUnclaimed(c)) return { ok: false, code: "ALREADY_CLAIMED" }
  const mine = (await store.listForUser(userId)).filter((x) => x.state !== "closed")
  if (mine.length >= MAX_CARDS_PER_USER) return { ok: false, code: "LIMIT" }
  if (mine.some((x) => x.name.toLowerCase() === c.name.toLowerCase()))
    return { ok: false, code: "NAME" }
  const card = { ...c, userId }
  await store.update(card)
  return { ok: true, card }
}

export function newCardId(now: Date, n: number): string {
  return `card_${now.getTime().toString(36)}${n.toString(36)}`
}

export class InMemoryCardStore implements CardStore {
  readonly kind = "memory"
  readonly m = new Map<string, VirtualCard>()
  constructor(seed: readonly VirtualCard[] = []) {
    for (const c of seed) this.m.set(c.id, c)
  }
  async get(id: string) {
    return this.m.get(id) ?? null
  }
  async listForUser(userId: string) {
    return [...this.m.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async create(c: VirtualCard) {
    if (this.m.has(c.id)) throw new Error("card exists")
    this.m.set(c.id, c)
  }
  async update(c: VirtualCard) {
    this.m.set(c.id, c)
  }
}
