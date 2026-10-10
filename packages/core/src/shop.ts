/**
 * The storefront (M12, ADR-0016): products listed by merchant recipients, carts grouped by merchant,
 * orders paid with ONE Lightning invoice per merchant that the merchant's own wallet mints. We are
 * never merchant of record: we hold catalogue data, order state and a payment hash — never money,
 * and never plaintext shipping details (those are sealed with SECRETS_KEY for the merchant only).
 */
import { createHash } from "node:crypto"
import { type Cents, type PriceSnapshot, type Sats, centsToSats } from "./money"

export type ProductKind = "digital" | "physical"

export const SHOP_CATEGORIES = [
  "books",
  "apparel",
  "gift-cards",
  "home",
  "kids",
  "sports",
  "food",
  "art",
  "electronics",
  "other",
] as const
export type ShopCategory = (typeof SHOP_CATEGORIES)[number]

export interface ShopProduct {
  /** Merchant-scoped id, `[a-z0-9-]`; the global id is `dir:<merchantSlug>:<id>`. */
  id: string
  merchantSlug: string
  /** Merchant-written; data to the agent. */
  title: string
  description?: string
  imageUrl?: string
  category: ShopCategory
  priceCents: Cents
  /** A sale price, shown as "Save $X". */
  dealCents?: Cents
  kind: ProductKind
  inStock: boolean
  /** ISO 3166 alpha-2 codes; empty = anywhere (digital goods ignore it). */
  shipsTo?: string[]
}

export type ShopOrderState = "unpaid" | "paid" | "fulfilled" | "cancelled"

export interface ShopOrderItem {
  productId: string
  title: string
  qty: number
  /** Unit price charged (deal price when there was one). */
  priceCents: Cents
  kind: ProductKind
}

export interface ShopOrder {
  id: string
  merchantSlug: string
  items: ShopOrderItem[]
  totalCents: Cents
  /** Sats at checkout, from the price snapshot stored alongside. */
  totalSats: Sats
  usdCentsPerBtc: Cents
  bolt11: string
  paymentHash: string
  state: ShopOrderState
  createdAt: string
  paidAt?: string
  fulfilledAt?: string
  preimage?: string
  /** AES-GCM blobs for the merchant only. Never plaintext, never logged. */
  shippingSealed?: string
  contactSealed?: string
  /** Opaque buyer key (hash), so a buyer can list their own orders; absent for anonymous web buyers. */
  buyerKey?: string
  /** Merchant's note to the buyer (tracking number etc.); data. */
  note?: string
}

export interface ProductStore {
  readonly kind: string
  get(merchantSlug: string, id: string): Promise<ShopProduct | null>
  /** In-stock products matching the words (title, description, category, merchant), all merchants. */
  search(
    query: string,
    opts?: { category?: ShopCategory; merchantSlug?: string; limit?: number },
  ): Promise<ShopProduct[]>
  listForMerchant(merchantSlug: string): Promise<ShopProduct[]>
  /** Products with a deal, newest first. */
  deals(limit?: number): Promise<ShopProduct[]>
  upsert(p: ShopProduct): Promise<void>
  remove(merchantSlug: string, id: string): Promise<void>
}

export interface OrderStore {
  readonly kind: string
  get(id: string): Promise<ShopOrder | null>
  getByPaymentHash(hash: string): Promise<ShopOrder | null>
  listForMerchant(merchantSlug: string, limit?: number): Promise<ShopOrder[]>
  listForBuyer(buyerKey: string, limit?: number): Promise<ShopOrder[]>
  create(o: ShopOrder): Promise<void>
  update(o: ShopOrder): Promise<void>
}

export const PRODUCT_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

/** `dir:<merchant>:<id>` ⇄ parts. The agent and the executor only ever see global ids. */
export function globalProductId(merchantSlug: string, id: string): string {
  return `dir:${merchantSlug}:${id}`
}
export function parseGlobalProductId(gid: string): { merchantSlug: string; id: string } | null {
  const m = /^dir:([a-z0-9][a-z0-9-]{1,62}):([a-z0-9][a-z0-9-]{0,62})$/.exec(gid)
  return m ? { merchantSlug: m[1] as string, id: m[2] as string } : null
}

export function effectivePriceCents(p: Pick<ShopProduct, "priceCents" | "dealCents">): Cents {
  return p.dealCents !== undefined && p.dealCents < p.priceCents ? p.dealCents : p.priceCents
}

export function productMatches(p: ShopProduct, query: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  const hay = `${p.title} ${p.description ?? ""} ${p.category} ${p.merchantSlug}`.toLowerCase()
  return q
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["the", "a", "an", "for", "me", "some", "from"].includes(t))
    .every((t) => hay.includes(t))
}

// --- cart maths (pure; the browser holds the cart) ---------------------------------------------

export interface CartLine {
  product: ShopProduct
  qty: number
}

export interface CartGroup {
  merchantSlug: string
  lines: CartLine[]
  totalCents: Cents
  needsShipping: boolean
}

/** One group per merchant: one invoice each, never pooled. Out-of-stock lines are dropped. */
export function groupCart(lines: readonly CartLine[]): CartGroup[] {
  const by = new Map<string, CartLine[]>()
  for (const l of lines) {
    if (!l.product.inStock || l.qty < 1) continue
    by.set(l.product.merchantSlug, [...(by.get(l.product.merchantSlug) ?? []), l])
  }
  return [...by.entries()].map(([merchantSlug, ls]) => ({
    merchantSlug,
    lines: ls,
    totalCents: ls.reduce((a, l) => a + effectivePriceCents(l.product) * BigInt(l.qty), 0n),
    needsShipping: ls.some((l) => l.product.kind === "physical"),
  }))
}

export function orderItemsFrom(lines: readonly CartLine[]): ShopOrderItem[] {
  return lines.map((l) => ({
    productId: l.product.id,
    title: l.product.title,
    qty: l.qty,
    priceCents: effectivePriceCents(l.product),
    kind: l.product.kind,
  }))
}

export function orderTotalCents(items: readonly ShopOrderItem[]): Cents {
  return items.reduce((a, i) => a + i.priceCents * BigInt(i.qty), 0n)
}

export function satsForCents(cents: Cents, price: PriceSnapshot): Sats {
  const s = centsToSats(cents, price)
  return s < 1n ? 1n : s
}

/** Lightning's proof of payment: sha256(preimage) must equal the invoice's payment hash. */
export function preimageMatches(preimageHex: string, paymentHash: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(preimageHex)) return false
  return (
    createHash("sha256").update(Buffer.from(preimageHex, "hex")).digest("hex") ===
    paymentHash.toLowerCase()
  )
}

export class InMemoryProductStore implements ProductStore {
  readonly kind = "memory"
  readonly m = new Map<string, ShopProduct>()
  constructor(seed: readonly ShopProduct[] = []) {
    for (const p of seed) this.m.set(globalProductId(p.merchantSlug, p.id), p)
  }
  async get(merchantSlug: string, id: string) {
    return this.m.get(globalProductId(merchantSlug, id)) ?? null
  }
  async search(
    query: string,
    opts: { category?: ShopCategory; merchantSlug?: string; limit?: number } = {},
  ) {
    return [...this.m.values()]
      .filter(
        (p) =>
          p.inStock &&
          (!opts.category || p.category === opts.category) &&
          (!opts.merchantSlug || p.merchantSlug === opts.merchantSlug) &&
          productMatches(p, query),
      )
      .slice(0, opts.limit ?? 50)
  }
  async listForMerchant(merchantSlug: string) {
    return [...this.m.values()].filter((p) => p.merchantSlug === merchantSlug)
  }
  async deals(limit = 12) {
    return [...this.m.values()]
      .filter((p) => p.inStock && p.dealCents !== undefined && p.dealCents < p.priceCents)
      .slice(0, limit)
  }
  async upsert(p: ShopProduct) {
    if (!PRODUCT_ID_RE.test(p.id)) throw new Error(`bad product id: ${p.id}`)
    this.m.set(globalProductId(p.merchantSlug, p.id), p)
  }
  async remove(merchantSlug: string, id: string) {
    this.m.delete(globalProductId(merchantSlug, id))
  }
}

export class InMemoryOrderStore implements OrderStore {
  readonly kind = "memory"
  readonly m = new Map<string, ShopOrder>()
  async get(id: string) {
    return this.m.get(id) ?? null
  }
  async getByPaymentHash(hash: string) {
    return [...this.m.values()].find((o) => o.paymentHash === hash.toLowerCase()) ?? null
  }
  async listForMerchant(merchantSlug: string, limit = 50) {
    return [...this.m.values()]
      .filter((o) => o.merchantSlug === merchantSlug)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  }
  async listForBuyer(buyerKey: string, limit = 50) {
    return [...this.m.values()]
      .filter((o) => o.buyerKey === buyerKey)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  }
  async create(o: ShopOrder) {
    if (this.m.has(o.id)) throw new Error("order exists")
    this.m.set(o.id, { ...o, paymentHash: o.paymentHash.toLowerCase() })
  }
  async update(o: ShopOrder) {
    this.m.set(o.id, { ...o })
  }
}
