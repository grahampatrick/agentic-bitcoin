/**
 * The Action contract: every bitcoin thing the assistant can do, as a typed request.
 *
 * The LLM (M3), the scheduler (M5) and a human in chat all produce Actions. Nothing else reaches a
 * rail. Amounts are integers (`money.ts`). Every spending action carries an `idempotencyKey` so a
 * retry can never pay twice.
 */
import { createHash } from "node:crypto"
import type { Cents, Sats } from "./money"

export type Requester = "user" | "schedule" | "agent"
export type RailName = "wallet" | "exchange" | "goods" | "compute"
export type ExchangeName = "strike" | "coinbase"
export type MerchantName = "bitrefill"

interface Base {
  /** Caller-chosen stable id. The same key must never execute twice. */
  idempotencyKey: string
  requestedBy: Requester
}

export interface PayInvoice extends Base {
  kind: "pay_invoice"
  bolt11: string
  /** Amount the caller believes the invoice is for (or chooses, for zero-amount invoices). */
  amountSats: Sats
  /** Payee identifier if known (node pubkey, lightning address, host) for allow/deny lists. */
  destination?: string
}

export interface PayAddress extends Base {
  kind: "pay_address"
  /** Lightning address, `name@domain`. */
  address: string
  amountSats: Sats
  memo?: string
}

export interface MakeInvoice extends Base {
  kind: "make_invoice"
  amountSats: Sats
  memo: string
  expirySeconds: number
}

export interface GetBalance extends Base {
  kind: "get_balance"
}

export interface BuyBitcoin extends Base {
  kind: "buy_bitcoin"
  exchange: ExchangeName
  usdCents: Cents
  /** Estimated sats at the time of the request, for caps and the confirmation summary. */
  estimatedSats: Sats
}

export interface ScheduleBuy extends Base {
  kind: "schedule_buy"
  exchange: ExchangeName
  usdCents: Cents
  /** Five-field cron expression, UTC. */
  cron: string
  estimatedSats: Sats
}

export interface CancelSchedule extends Base {
  kind: "cancel_schedule"
  scheduleId: string
}

export interface BuyProduct extends Base {
  kind: "buy_product"
  merchant: MerchantName
  productId: string
  description: string
  usdCents: Cents
  amountSats: Sats
}

export interface SearchProducts extends Base {
  kind: "search_products"
  merchant: MerchantName
  query: string
}

export interface PayL402 extends Base {
  kind: "pay_l402"
  url: string
  /** Host of the URL, kept explicit so allow/deny lists are cheap to apply. */
  host: string
  /** Ceiling: the challenge's invoice must be at or under this. */
  amountSats: Sats
  method?: "GET" | "POST"
  /** Request body for POST, already serialised. */
  body?: string
  /** Extra request headers (never Authorization — the rail owns that). */
  headers?: Record<string, string>
}

export type Action =
  | PayInvoice
  | PayAddress
  | MakeInvoice
  | GetBalance
  | BuyBitcoin
  | ScheduleBuy
  | CancelSchedule
  | BuyProduct
  | SearchProducts
  | PayL402

export type ActionKind = Action["kind"]

export const RAIL_FOR_KIND: Record<ActionKind, RailName> = {
  pay_invoice: "wallet",
  pay_address: "wallet",
  make_invoice: "wallet",
  get_balance: "wallet",
  buy_bitcoin: "exchange",
  schedule_buy: "exchange",
  cancel_schedule: "exchange",
  buy_product: "goods",
  search_products: "goods",
  pay_l402: "compute",
}

export function railOf(action: Action): RailName {
  return RAIL_FOR_KIND[action.kind]
}

/** Sats that would leave the user's control if this action succeeds. Reads and receives are 0. */
export function spendSats(action: Action): Sats {
  switch (action.kind) {
    case "pay_invoice":
    case "pay_address":
    case "buy_product":
    case "pay_l402":
      return action.amountSats
    case "buy_bitcoin":
    case "schedule_buy":
      // Fiat leaves the exchange balance; we budget it in sats at the quoted estimate.
      return action.estimatedSats
    case "make_invoice":
    case "get_balance":
    case "cancel_schedule":
    case "search_products":
      return 0n
  }
}

/** The counterparty, normalised to lower case, for allow/deny list matching. */
export function destinationOf(action: Action): string | null {
  switch (action.kind) {
    case "pay_invoice":
      return action.destination?.toLowerCase() ?? null
    case "pay_address":
      return action.address.toLowerCase()
    case "pay_l402":
      return action.host.toLowerCase()
    case "buy_product":
      return action.merchant
    case "buy_bitcoin":
    case "schedule_buy":
      return action.exchange
    case "make_invoice":
    case "get_balance":
    case "cancel_schedule":
    case "search_products":
      return null
  }
}

/** True when money leaves; such actions must carry idempotency keys and hit the budget. */
export function isSpend(action: Action): boolean {
  return spendSats(action) > 0n
}

/** One line a human can read before confirming. Never includes secrets. */
export function describeAction(action: Action): string {
  switch (action.kind) {
    case "pay_invoice":
      return `Pay a Lightning invoice${action.destination ? ` to ${action.destination}` : ""}`
    case "pay_address":
      return `Pay ${action.address}${action.memo ? ` ("${action.memo}")` : ""}`
    case "make_invoice":
      return `Create an invoice for "${action.memo}"`
    case "get_balance":
      return "Check the wallet balance"
    case "buy_bitcoin":
      return `Buy bitcoin on ${action.exchange}`
    case "schedule_buy":
      return `Schedule a recurring buy on ${action.exchange} (${action.cron})`
    case "cancel_schedule":
      return `Cancel schedule ${action.scheduleId}`
    case "buy_product":
      return `Buy "${action.description}" from ${action.merchant}`
    case "search_products":
      return `Search ${action.merchant} for "${action.query}"`
    case "pay_l402":
      return `Pay ${action.host} for an API request`
  }
}

// --- serialisation: bigint ↔ decimal string -----------------------------------------------

type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

function toJson(v: unknown): Json {
  if (typeof v === "bigint") return `${v.toString()}n`
  if (Array.isArray(v)) return v.map(toJson)
  if (v && typeof v === "object") {
    const out: { [k: string]: Json } = {}
    for (const k of Object.keys(v as object).sort()) {
      const val = (v as Record<string, unknown>)[k]
      if (val !== undefined) out[k] = toJson(val)
    }
    return out
  }
  return v as Json
}

function fromJson(v: Json): unknown {
  if (typeof v === "string" && /^\d+n$/.test(v)) return BigInt(v.slice(0, -1))
  if (Array.isArray(v)) return v.map(fromJson)
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) out[k] = fromJson(val)
    return out
  }
  return v
}

/** Canonical JSON (sorted keys, bigints as "123n"). Stable across processes; used for hashing. */
export function serializeAction(action: Action): string {
  return JSON.stringify(toJson(action))
}

export function parseAction(text: string): Action {
  const parsed = fromJson(JSON.parse(text) as Json) as Action
  if (!parsed || typeof parsed !== "object" || !(parsed.kind in RAIL_FOR_KIND)) {
    throw new Error("not an Action")
  }
  return parsed
}

/**
 * sha256 of the canonical form. A confirmation is bound to this hash, so a model (or a bug)
 * cannot "confirm" one action and execute another.
 */
export function actionHash(action: Action): string {
  return createHash("sha256").update(serializeAction(action)).digest("hex")
}
