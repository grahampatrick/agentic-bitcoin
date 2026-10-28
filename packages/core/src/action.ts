/**
 * The Action contract: every bitcoin thing the assistant can do, as a typed request.
 *
 * The LLM (M3), the scheduler (M5) and a human in chat all produce Actions. Nothing else reaches a
 * rail. Amounts are integers (`money.ts`). Every spending action carries an `idempotencyKey` so a
 * retry can never pay twice.
 */
import { createHash } from "node:crypto"
import type { InvoiceItem } from "./invoice"
import type { Cents, Sats } from "./money"
import type { GivePurpose } from "./recipient"

export type Requester = "user" | "schedule" | "agent"
export type RailName = "wallet" | "exchange" | "goods" | "compute" | "onchain"
export type ExchangeName = "strike" | "coinbase"
export type MerchantName = "bitrefill" | "directory"

interface Base {
  /** Caller-chosen stable id. The same key must never execute twice. */
  idempotencyKey: string
  requestedBy: Requester
  /** M17a: set by the executor when a spend lands on one of the user's virtual cards. */
  cardId?: string
  /**
   * M21 (ADR-0024): a note for the user's own eyes. It never reaches a rail, a memo or an invoice:
   * the executor strips it from the stored action and keeps it as a `noted` ledger event, sealed
   * with SECRETS_KEY when the server has one.
   */
  privateNote?: string
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
  /** Bitrefill ids as-is; directory products as `dir:<merchant>:<id>`. */
  productId: string
  description: string
  usdCents: Cents
  amountSats: Sats
  /** M12: shipping/contact details SEALED (AES-GCM) before this became an Action; the ledger never holds plaintext. */
  shippingSealed?: string
  contactSealed?: string
}

export interface SearchProducts extends Base {
  kind: "search_products"
  merchant: MerchantName
  query: string
}

/**
 * Move Lightning/on-chain balance above `keepSats` to a cold-storage address the user registered.
 * `maxSats` is the ceiling for this run (budgeted like any spend); the actual amount is
 * min(balance − keepSats, maxSats), computed at execution.
 */
export interface SweepToCold extends Base {
  kind: "sweep_to_cold"
  address: string
  keepSats: Sats
  maxSats: Sats
  /** Fee rate; adapters default sensibly when omitted. */
  satPerVbyte?: number
}

export interface ScheduleSweep extends Base {
  kind: "schedule_sweep"
  address: string
  keepSats: Sats
  maxSats: Sats
  cron: string
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

/**
 * Give to a recipient from the directory (or the user's private list). The action carries the
 * RESOLVED recipient — name, Lightning address, trust — so the confirmation hash binds exactly
 * what the human saw, and the policy can judge the destination without any lookup.
 */
export interface Give extends Base {
  kind: "give"
  recipientSlug: string
  recipientName: string
  /** The recipient's Lightning address at request time; the wallet rail resolves it to an invoice. */
  address: string
  /** Verified directory entry, or the user's own private recipient. Unverified gifts are denied. */
  verified: boolean
  amountSats: Sats
  purpose: GivePurpose
  /** The giver's note, passed to the recipient as the invoice memo. */
  note?: string
  /** USD cents at request time, for the giving statement. */
  fiatCentsAtRequest?: Cents
  /** M11: the campaign this gift supports, if any. */
  campaignSlug?: string
  /** Opt-in first name shown to the recipient and on the campaign page; data. */
  supporterName?: string
}

export interface ScheduleGive extends Base {
  kind: "schedule_give"
  recipientSlug: string
  recipientName: string
  address: string
  verified: boolean
  /** Sats per firing (re-priced from usdCents at fire time when usdCents is set). */
  amountSats: Sats
  usdCents?: Cents
  cron: string
  purpose: GivePurpose
  campaignSlug?: string
  supporterName?: string
}

/**
 * M20: a bill. A recurring payment to a Lightning address the user names (rent, a subscription, a
 * phone plan at a provider that takes sats): dollars re-priced at pay time or fixed sats, on a cron.
 * `mode: "auto"` pays on the day; `mode: "ask"` parks the payment and asks for a yes instead.
 */
export interface ScheduleBill extends Base {
  kind: "schedule_bill"
  /** "Rent", "Phone plan". */
  name: string
  address: string
  /** Sats per firing (re-priced from usdCents at fire time when usdCents is set). */
  amountSats: Sats
  usdCents?: Cents
  cron: string
  mode: "auto" | "ask"
  memo?: string
}

export interface FindRecipient extends Base {
  kind: "find_recipient"
  query: string
}

/** The user's recurring actions (buys, sweeps, gifts), so they can pause or change them. */
export interface ListSchedules extends Base {
  kind: "list_schedules"
}

/** What the user has given: per recipient and in total, for a year. Read-only, from the ledger. */
export interface GivingSummary extends Base {
  kind: "giving_summary"
  year: number
}

/** The user's sats-back: pending, payable and paid. Read-only. */
export interface RewardsSummary extends Base {
  kind: "rewards_summary"
}

/**
 * M14: issue a bill (or a one-line payment request) that someone pays over Lightning. Moves no sats:
 * the issuer's wallet mints the BOLT11 and our pay link points at it. The payer's contact is sealed.
 */
export interface CreateInvoice extends Base {
  kind: "create_invoice"
  invoiceKind: "invoice" | "request"
  payerName: string
  payerContactSealed?: string
  items: InvoiceItem[]
  memo?: string
  dueAt?: string
  /** Recurring: when set, a schedule is created and each firing issues a fresh invoice due `dueDays` later. */
  cron?: string
  dueDays?: number
}

export interface ListInvoices extends Base {
  kind: "list_invoices"
  /** open | overdue | paid | void | all */
  filter: string
}

export interface VoidInvoice extends Base {
  kind: "void_invoice"
  invoiceId: string
}

/**
 * M17a: a virtual Lightning card — a named, scoped monthly budget on the user's own wallet. Creating
 * one moves no sats and never loosens the user's policy; it only narrows what matching spends may do.
 */
export interface CreateCard extends Base {
  kind: "create_card"
  name: string
  scope: readonly string[]
  monthlyCapSats: Sats
  perActionCapSats?: Sats
  confirmAboveSats?: Sats
  /** 1–28 (UTC). */
  resetDay: number
}

export interface ListCards extends Base {
  kind: "list_cards"
}

export interface UpdateCard extends Base {
  kind: "update_card"
  cardId: string
  op: "pause" | "resume" | "close" | "set_limit"
  monthlyCapSats?: Sats
}

/**
 * M21: attach a private note to an earlier payment (or clear it with an empty `privateNote`). The
 * text travels in `privateNote` so it is sealed like every other note; the target is an entry id
 * (prefix), a text match on the payment's summary, or the most recent payment when both are empty.
 */
export interface AddNote extends Base {
  kind: "add_note"
  entryId?: string
  match?: string
}

export type Action =
  | Give
  | ScheduleGive
  | ScheduleBill
  | FindRecipient
  | ListSchedules
  | GivingSummary
  | RewardsSummary
  | CreateInvoice
  | ListInvoices
  | VoidInvoice
  | CreateCard
  | ListCards
  | UpdateCard
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
  | SweepToCold
  | ScheduleSweep
  | AddNote

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
  sweep_to_cold: "onchain",
  schedule_sweep: "onchain",
  give: "wallet",
  schedule_give: "wallet",
  schedule_bill: "wallet",
  find_recipient: "wallet",
  list_schedules: "wallet",
  giving_summary: "wallet",
  rewards_summary: "wallet",
  create_invoice: "wallet",
  list_invoices: "wallet",
  void_invoice: "wallet",
  create_card: "wallet",
  list_cards: "wallet",
  update_card: "wallet",
  add_note: "wallet",
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
    case "give":
    case "schedule_give":
    case "schedule_bill":
      return action.amountSats
    case "buy_bitcoin":
    case "schedule_buy":
      // Fiat leaves the exchange balance; we budget it in sats at the quoted estimate.
      return action.estimatedSats
    case "sweep_to_cold":
    case "schedule_sweep":
      // Sats move to the user's own cold storage, but still leave the hot wallet: budget the ceiling.
      return action.maxSats
    case "make_invoice":
    case "get_balance":
    case "cancel_schedule":
    case "search_products":
    case "find_recipient":
    case "list_schedules":
    case "giving_summary":
    case "rewards_summary":
    case "create_invoice":
    case "list_invoices":
    case "void_invoice":
    case "create_card":
    case "list_cards":
    case "update_card":
    case "add_note":
      return 0n
  }
}

/** The counterparty, normalised to lower case, for allow/deny list matching. */
export function destinationOf(action: Action): string | null {
  switch (action.kind) {
    case "pay_invoice":
      return action.destination?.toLowerCase() ?? null
    case "pay_address":
    case "give":
    case "schedule_give":
    case "schedule_bill":
      return action.address.toLowerCase()
    case "pay_l402":
      return action.host.toLowerCase()
    case "buy_product":
      return action.merchant
    case "buy_bitcoin":
    case "schedule_buy":
      return action.exchange
    case "sweep_to_cold":
    case "schedule_sweep":
      return action.address
    case "make_invoice":
    case "get_balance":
    case "cancel_schedule":
    case "search_products":
    case "find_recipient":
    case "list_schedules":
    case "giving_summary":
    case "rewards_summary":
    case "create_invoice":
    case "list_invoices":
    case "void_invoice":
    case "create_card":
    case "list_cards":
    case "update_card":
    case "add_note":
      return null
  }
}

/** True when money leaves; such actions must carry idempotency keys and hit the budget. */
export function isSpend(action: Action): boolean {
  return spendSats(action) > 0n
}

/** One line a human can read before confirming. Never includes secrets. */
export function describeAction(action: Action): string {
  const what = describeKind(action)
  // the note is shown to the person confirming (it is theirs); it is never part of what the payee sees
  return action.privateNote && action.kind !== "add_note"
    ? `${what} · private note “${action.privateNote}”`
    : what
}

function describeKind(action: Action): string {
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
    case "sweep_to_cold":
      return `Sweep to cold storage ${action.address.slice(0, 8)}…${action.address.slice(-4)}, keeping ${action.keepSats} sats hot`
    case "schedule_sweep":
      return `Schedule a sweep to ${action.address.slice(0, 8)}…${action.address.slice(-4)} (${action.cron})`
    case "pay_l402":
      return `Pay ${action.host} for an API request`
    case "give":
      return `Give to ${action.recipientName} <${action.address}> (${action.purpose}${action.campaignSlug ? `, campaign ${action.campaignSlug}` : ""})${action.note ? ` "${action.note}"` : ""}`
    case "schedule_give":
      return `Schedule giving to ${action.recipientName} <${action.address}> (${action.purpose}${action.campaignSlug ? `, campaign ${action.campaignSlug}` : ""}, ${action.cron})`
    case "schedule_bill":
      return `Schedule the bill “${action.name}” to ${action.address} (${action.cron}, ${action.mode === "ask" ? "asks you first" : "pays automatically"})`
    case "find_recipient":
      return `Find a recipient matching "${action.query}"`
    case "list_schedules":
      return "List recurring actions"
    case "giving_summary":
      return `Summarize giving in ${action.year}`
    case "rewards_summary":
      return "Show sats-back rewards"
    case "create_invoice":
      return `${action.invoiceKind === "request" ? "Request payment from" : "Invoice"} ${action.payerName}${action.cron ? ` (recurring, ${action.cron})` : ""}`
    case "list_invoices":
      return `List ${action.filter} invoices`
    case "void_invoice":
      return `Void invoice ${action.invoiceId}`
    case "create_card":
      return `Create virtual card “${action.name}” (${action.scope.join(", ")}) with a ${formatSatsPlain(action.monthlyCapSats)} monthly limit`
    case "list_cards":
      return "List virtual cards"
    case "update_card":
      return action.op === "set_limit"
        ? `Set card ${action.cardId} monthly limit to ${formatSatsPlain(action.monthlyCapSats ?? 0n)}`
        : `${action.op[0]?.toUpperCase()}${action.op.slice(1)} card ${action.cardId}`
    case "add_note":
      return action.privateNote
        ? `Add a private note to ${action.entryId ? `payment ${action.entryId}` : action.match ? `the payment matching “${action.match}”` : "the last payment"}`
        : `Remove the private note from ${action.entryId ? `payment ${action.entryId}` : action.match ? `the payment matching “${action.match}”` : "the last payment"}`
  }
}

function formatSatsPlain(n: bigint): string {
  return `${n.toLocaleString("en-US")} sats`
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
