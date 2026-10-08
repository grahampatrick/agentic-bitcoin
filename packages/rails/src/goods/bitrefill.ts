/**
 * Bitrefill goods rail (M6). Gift cards, phone top-ups, eSIMs — paid in sats from the user's own
 * wallet. The state machine every future merchant copies: create invoice → pay the BOLT11 through
 * the wallet rail → poll until DELIVERED → read redemption once.
 *
 * Verified 2026-10-07 (bitrefill/agents touchpoints/api.md + the OpenAPI reference):
 *   base https://api.bitrefill.com/v2 · Personal API: `Authorization: Bearer <key>`
 *   GET  /products/search?q=…&limit=…        → data[{id,name,country_code,currency,in_stock,packages|range}]
 *   POST /invoices {products:[{product_id, quantity, value|package_id}], payment_method:"lightning"}
 *        → data{id,status,payment{method,address,currency,price,status},orders[{id,status,product,delivered_time}]}
 *   GET  /invoices/{id}                       poll until status "complete"
 *   GET  /orders/{id}                         → data.redemption_info {code,link,pin,instructions}
 * Assumptions the live demo verifies (the reference does not spell them out): for a lightning
 * invoice the BOLT11 is in `payment.address` (or `payment.lightning_invoice`); the sats amount is
 * taken from DECODING the BOLT11, never from a fiat field; an order is delivered when its status
 * is "delivered"/"complete" or `delivered_time` is set.
 */
import {
  type Cents,
  type GoodsRail,
  type Order,
  type OrderState,
  type Product,
  RailError,
  type RailErrorCode,
  SATS_PER_BTC,
} from "@agentic-bitcoin/core"
import { decodeInvoice } from "@getalby/lightning-tools"

export interface BitrefillConfig {
  apiKey: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** Include Bitrefill's no-charge test products in search (Business/Affiliate keys only). */
  includeTestProducts?: boolean
}

type Envelope<T> = { data: T; meta?: unknown; message?: string; error_code?: string }
type RawProduct = {
  id: string
  name: string
  country_code?: string
  currency?: string
  in_stock?: boolean
  packages?:
    | { id: string; value: string; price: number }
    | { id: string; value: string; price: number }[]
  range?: { min: number; max: number; step: number; price_rate: number }
}
type RawOrder = {
  id: string
  status?: string
  delivered_time?: string | null
  product?: { id: string; name: string; value?: string; currency?: string }
  redemption_info?:
    | string
    | { code?: string; link?: string; pin?: string; instructions?: string; [k: string]: unknown }
}
type RawInvoice = {
  id: string
  status?: string
  payment?: {
    method?: string
    address?: string
    lightning_invoice?: string
    currency?: string
    price?: number
    status?: string
  }
  orders?: RawOrder[]
}

const ERROR_CODES: Record<string, RailErrorCode> = {
  unsupported_payment_method: "BAD_CONFIG",
  product_not_found: "NOT_FOUND",
  out_of_stock: "REJECTED",
  invalid_value: "AMOUNT_OUT_OF_RANGE",
  insufficient_balance: "INSUFFICIENT_FUNDS",
}

export class BitrefillGoodsRail implements GoodsRail {
  readonly kind = "bitrefill"
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  /** orderId → invoiceId, so getOrder can poll the invoice (the order endpoint has no payment state). */
  private readonly invoiceOf = new Map<string, string>()

  constructor(private readonly cfg: BitrefillConfig) {
    if (!cfg.apiKey) throw new RailError("bitrefill", "BAD_CONFIG", "Bitrefill API key missing")
    this.baseUrl = (cfg.baseUrl ?? "https://api.bitrefill.com/v2").replace(/\/$/, "")
    this.fetchImpl = cfg.fetchImpl ?? fetch
    this.timeoutMs = cfg.timeoutMs ?? 20_000
  }

  async searchProducts(query: string): Promise<Product[]> {
    const q = query.trim().slice(0, 100)
    if (!q) return []
    const params = new URLSearchParams({ q, limit: "20" })
    if (this.cfg.includeTestProducts) params.set("include_test_products", "true")
    const res = (await this.call("GET", `/products/search?${params}`)) as Envelope<RawProduct[]>
    return (res.data ?? [])
      .filter((p) => p.in_stock !== false)
      .map((p) => ({ id: p.id, name: productLabel(p), usdCents: fixedPriceCents(p) }))
  }

  async createOrder(input: { productId: string; usdCents: Cents }): Promise<Order> {
    if (input.usdCents <= 0n)
      throw new RailError(this.kind, "AMOUNT_OUT_OF_RANGE", "amount must be > 0")
    const res = (await this.call("POST", "/invoices", {
      products: [{ product_id: input.productId, quantity: 1, value: Number(input.usdCents) / 100 }], // money-ok: Bitrefill wants a decimal; cents stay the source of truth
      payment_method: "lightning",
    })) as Envelope<RawInvoice>
    const inv = res.data
    const order = inv?.orders?.[0]
    if (!inv?.id || !order?.id)
      throw new RailError(this.kind, "BAD_RESPONSE", "invoice response has no order")
    const bolt11 =
      inv.payment?.lightning_invoice ??
      (inv.payment?.address?.toLowerCase().startsWith("ln") ? inv.payment.address : undefined)
    if (!bolt11)
      throw new RailError(this.kind, "BAD_RESPONSE", "invoice has no lightning payment request")
    const decoded = decodeInvoice(bolt11)
    if (!decoded || decoded.satoshi <= 0)
      throw new RailError(this.kind, "BAD_RESPONSE", "invoice bolt11 is undecodable or amountless")
    this.invoiceOf.set(order.id, inv.id)
    return {
      orderId: order.id,
      bolt11,
      amountSats: BigInt(decoded.satoshi),
      state: stateOf(inv, order),
    }
  }

  async getOrder(orderId: string): Promise<Order> {
    const invoiceId = this.invoiceOf.get(orderId)
    // The invoice carries payment + delivery state; the order carries redemption. Ask the invoice first.
    const inv = invoiceId
      ? (
          (await this.call(
            "GET",
            `/invoices/${encodeURIComponent(invoiceId)}`,
          )) as Envelope<RawInvoice>
        ).data
      : undefined
    const invOrder = inv?.orders?.find((o) => o.id === orderId)
    let state: OrderState = inv ? stateOf(inv, invOrder) : "unpaid"
    let redemption: string | undefined
    if (!inv || state === "delivered") {
      const ord = (
        (await this.call("GET", `/orders/${encodeURIComponent(orderId)}`)) as Envelope<RawOrder>
      ).data
      if (!ord?.id) throw new RailError(this.kind, "NOT_FOUND", orderId)
      if (!inv) state = orderDelivered(ord) ? "delivered" : "unpaid"
      if (orderDelivered(ord) || state === "delivered") {
        state = "delivered"
        redemption = redemptionText(ord.redemption_info)
      }
    }
    const bolt11 = inv?.payment?.lightning_invoice ?? inv?.payment?.address ?? ""
    const sats = bolt11 ? BigInt(decodeInvoice(bolt11)?.satoshi ?? 0) : 0n
    return { orderId, bolt11, amountSats: sats, state, redemption }
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.apiKey}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new RailError(this.kind, "UNREACHABLE", `bitrefill ${path}: ${(err as Error).message}`)
    }
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }
    if (res.ok) return parsed
    const e = parsed as { message?: string; error_code?: string } | null
    const message = e?.message ?? text.slice(0, 200)
    if (res.status === 401 || res.status === 403)
      throw new RailError(
        this.kind,
        "UNAUTHORIZED",
        `bitrefill ${res.status}: ${message || "check the API key"}`,
      )
    if (res.status === 404) throw new RailError(this.kind, "NOT_FOUND", `bitrefill 404 ${path}`)
    if (res.status === 429) throw new RailError(this.kind, "UNREACHABLE", "bitrefill rate limited")
    const code = e?.error_code
    const mapped = (code && ERROR_CODES[code]) || (res.status >= 500 ? "UNREACHABLE" : "REJECTED")
    throw new RailError(
      this.kind,
      mapped,
      `bitrefill ${res.status} ${code ?? ""}: ${message}`.trim(),
    )
  }
}

function stateOf(inv: RawInvoice, order?: RawOrder): OrderState {
  if (order && orderDelivered(order)) return "delivered"
  const s = (inv.status ?? "").toLowerCase()
  const ps = (inv.payment?.status ?? "").toLowerCase()
  if (s === "complete" || s === "delivered") return "delivered"
  if (
    s === "expired" ||
    s === "cancelled" ||
    s === "canceled" ||
    s === "failed" ||
    ps === "expired"
  )
    return "failed"
  if (
    ps === "paid" ||
    ps === "confirmed" ||
    ps === "complete" ||
    s === "not_delivered" ||
    s === "paid"
  )
    return ps === "unpaid" ? "unpaid" : "paid"
  return "unpaid"
}

function orderDelivered(o: RawOrder): boolean {
  const s = (o.status ?? "").toLowerCase()
  return s === "delivered" || s === "complete" || (!!o.delivered_time && s !== "created")
}

/** Redemption as one string the surface delivers once. Object form → "code: …; pin: …; link: …". */
export function redemptionText(r: RawOrder["redemption_info"]): string | undefined {
  if (!r) return undefined
  if (typeof r === "string") return r
  const parts: string[] = []
  for (const k of ["code", "pin", "link", "instructions"] as const) {
    const v = r[k]
    if (typeof v === "string" && v.trim()) parts.push(`${k}: ${v.trim()}`)
  }
  return parts.length ? parts.join("; ") : JSON.stringify(r)
}

function productLabel(p: RawProduct): string {
  const where = p.country_code ? ` (${p.country_code})` : ""
  const range = p.range ? ` ${p.range.min}–${p.range.max} ${p.currency ?? ""}` : ""
  return `${p.name}${where}${range}`.trim()
}

/** A single fixed package → its price in cents; ranged or multi-package products → null (customer picks). */
function fixedPriceCents(p: RawProduct): Cents | null {
  const pk = Array.isArray(p.packages)
    ? p.packages.length === 1
      ? p.packages[0]
      : undefined
    : p.packages
  if (!pk || p.range) return null
  return BigInt(Math.round(pk.price * 100)) // money-ok: boundary, merchant reports a decimal
}

export const _internal = { stateOf, orderDelivered, SATS_PER_BTC }
