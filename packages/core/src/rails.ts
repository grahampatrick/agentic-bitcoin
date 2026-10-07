/**
 * Rail contracts. Adapters (M2 NWC, M4 L402, M5 Strike, M6 Bitrefill) implement these; the
 * executor only ever talks to them through the interface. Every adapter must pass the contract
 * suite in `test/rail-contract.ts` — the fakes below are the reference implementations.
 *
 * One wallet socket (non-negotiable #6): merchant and compute rails hand back BOLT11 invoices;
 * only a WalletRail pays them.
 */
import type { Cents, Sats } from "./money"

export type RailErrorCode =
  | "UNREACHABLE"
  | "UNAUTHORIZED"
  | "REJECTED"
  | "NOT_FOUND"
  | "BAD_RESPONSE"
  | "INSUFFICIENT_FUNDS"
  | "AMOUNT_OUT_OF_RANGE"
  | "EXPIRED"
  | "BAD_CONFIG"
  /** The rail cannot say whether money moved (e.g. timeout after pay). Caller must NOT retry blindly. */
  | "UNKNOWN_STATE"

export class RailError extends Error {
  readonly code: RailErrorCode
  readonly rail: string
  constructor(rail: string, code: RailErrorCode, message: string) {
    super(message)
    this.name = "RailError"
    this.rail = rail
    this.code = code
  }
}

// --- wallet -----------------------------------------------------------------------------------

export interface Invoice {
  bolt11: string
  paymentHash: string
  amountSats: Sats
  expiresAt: string
}

export type InvoiceState = "pending" | "settled" | "expired"

export interface InvoiceLookup {
  state: InvoiceState
  settledAt?: string
  preimage?: string
}

export interface Payment {
  paymentHash: string
  preimage: string
  amountSats: Sats
  feeSats: Sats
}

export interface WalletRail {
  readonly kind: string
  getBalance(): Promise<{ sats: Sats }>
  makeInvoice(input: { amountSats: Sats; memo: string; expirySeconds: number }): Promise<Invoice>
  /**
   * Pay a BOLT11. `amountSats` is required for zero-amount invoices and must match otherwise.
   * Adapters MUST be idempotent on `idempotencyKey`: a retry returns the original payment.
   */
  payInvoice(input: { bolt11: string; amountSats: Sats; idempotencyKey: string }): Promise<Payment>
  lookupInvoice(paymentHash: string): Promise<InvoiceLookup>
  /** LNURL-pay / lightning address → a BOLT11 for the amount. */
  resolveAddress(address: string, amountSats: Sats, memo?: string): Promise<{ bolt11: string }>
}

// --- exchange ---------------------------------------------------------------------------------

export interface Quote {
  id: string
  usdCents: Cents
  sats: Sats
  /** Cents per BTC implied by the quote. */
  usdCentsPerBtc: Cents
  expiresAt: string
}

export interface Execution {
  quoteId: string
  sats: Sats
  usdCents: Cents
  executedAt: string
}

export interface ExchangeRail {
  readonly kind: string
  getRate(): Promise<{ usdCentsPerBtc: Cents; asOf: string }>
  createQuote(input: { usdCents: Cents }): Promise<Quote>
  /** Must be called before `expiresAt`, else EXPIRED. Idempotent per quote id. */
  executeQuote(quoteId: string): Promise<Execution>
}

// --- goods ------------------------------------------------------------------------------------

export interface Product {
  id: string
  name: string
  /** Fixed price in cents, or null when the customer picks an amount. */
  usdCents: Cents | null
}

export type OrderState = "unpaid" | "paid" | "delivered" | "failed"

export interface Order {
  orderId: string
  bolt11: string
  amountSats: Sats
  state: OrderState
  /** Redemption data once delivered. Bearer secret: encrypt at rest, never log. */
  redemption?: string
}

export interface GoodsRail {
  readonly kind: string
  searchProducts(query: string): Promise<Product[]>
  createOrder(input: { productId: string; usdCents: Cents }): Promise<Order>
  /** Poll until `delivered`; `paid` is NOT delivery (ADR-0011). */
  getOrder(orderId: string): Promise<Order>
}

// --- compute ----------------------------------------------------------------------------------

export interface L402Challenge {
  macaroon: string
  invoice: string
  amountSats: Sats
}

export interface ComputeRail {
  readonly kind: string
  /** Do the request; if it 402s, return the challenge instead of a body. */
  request(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<
    | { status: 402; challenge: L402Challenge }
    | { status: number; body: string; headers: Record<string, string> }
  >
  /** Retry with proof of payment. */
  requestWithToken(
    url: string,
    token: { macaroon: string; preimage: string },
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; body: string; headers: Record<string, string> }>
}

export interface Rails {
  wallet?: WalletRail
  exchange?: ExchangeRail
  goods?: GoodsRail
  compute?: ComputeRail
}
