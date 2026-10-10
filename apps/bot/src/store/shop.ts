/**
 * Storefront stores (M12): products and orders, file-backed for a single operator, Supabase in
 * production (supabase/migrations/0007_shop.sql). Orders hold sealed shipping blobs only.
 */
import { readFileSync } from "node:fs"
import {
  type OrderStore,
  PRODUCT_ID_RE,
  type ProductStore,
  SHOP_CATEGORIES,
  type ShopCategory,
  type ShopOrder,
  type ShopProduct,
  globalProductId,
  productMatches,
} from "@agentic-bitcoin/core"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { FileState } from "./file"

const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))
const dec = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x,
  ) as T

export class FileProductStore implements ProductStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private all(): ShopProduct[] {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("p:"))
      .map((k) => dec<ShopProduct>(this.f.get("shop", k) ?? ""))
  }
  async get(merchantSlug: string, id: string) {
    const v = this.f.get("shop", `p:${globalProductId(merchantSlug, id)}`)
    return v ? dec<ShopProduct>(v) : null
  }
  async search(
    query: string,
    opts: { category?: ShopCategory; merchantSlug?: string; limit?: number } = {},
  ) {
    return this.all()
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
    return this.all().filter((p) => p.merchantSlug === merchantSlug)
  }
  async deals(limit = 12) {
    return this.all()
      .filter((p) => p.inStock && p.dealCents !== undefined && p.dealCents < p.priceCents)
      .slice(0, limit)
  }
  async upsert(p: ShopProduct) {
    if (!PRODUCT_ID_RE.test(p.id)) throw new Error(`bad product id: ${p.id}`)
    this.f.set("shop", `p:${globalProductId(p.merchantSlug, p.id)}`, enc(p))
  }
  async remove(merchantSlug: string, id: string) {
    this.f.set("shop", `p:${globalProductId(merchantSlug, id)}`, null)
  }
}

export class FileOrderStore implements OrderStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private all(): ShopOrder[] {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("o:"))
      .map((k) => dec<ShopOrder>(this.f.get("shop", k) ?? ""))
  }
  async get(id: string) {
    const v = this.f.get("shop", `o:${id}`)
    return v ? dec<ShopOrder>(v) : null
  }
  async getByPaymentHash(hash: string) {
    return this.all().find((o) => o.paymentHash === hash.toLowerCase()) ?? null
  }
  async listForMerchant(merchantSlug: string, limit = 50) {
    return this.all()
      .filter((o) => o.merchantSlug === merchantSlug)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  }
  async listForBuyer(buyerKey: string, limit = 50) {
    return this.all()
      .filter((o) => o.buyerKey === buyerKey)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  }
  async create(o: ShopOrder) {
    if (this.f.get("shop", `o:${o.id}`)) throw new Error("order exists")
    this.f.set("shop", `o:${o.id}`, enc({ ...o, paymentHash: o.paymentHash.toLowerCase() }))
  }
  async update(o: ShopOrder) {
    this.f.set("shop", `o:${o.id}`, enc(o))
  }
}

type ProductRow = {
  merchant_slug: string
  id: string
  title: string
  description: string | null
  image_url: string | null
  category: string
  price_cents: string
  deal_cents: string | null
  kind: string
  in_stock: boolean
  ships_to: string[] | null
}
const productFromRow = (r: ProductRow): ShopProduct => ({
  id: r.id,
  merchantSlug: r.merchant_slug,
  title: r.title,
  description: r.description ?? undefined,
  imageUrl: r.image_url ?? undefined,
  category: r.category as ShopCategory,
  priceCents: BigInt(r.price_cents),
  dealCents: r.deal_cents ? BigInt(r.deal_cents) : undefined,
  kind: r.kind as ShopProduct["kind"],
  inStock: r.in_stock,
  shipsTo: r.ships_to ?? undefined,
})
type OrderRow = {
  id: string
  merchant_slug: string
  items: string
  total_cents: string
  total_sats: string
  usd_cents_per_btc: string
  bolt11: string
  payment_hash: string
  state: string
  created_at: string
  paid_at: string | null
  fulfilled_at: string | null
  preimage: string | null
  shipping_sealed: string | null
  contact_sealed: string | null
  buyer_key: string | null
  note: string | null
}
const orderFromRow = (r: OrderRow): ShopOrder => ({
  id: r.id,
  merchantSlug: r.merchant_slug,
  items: dec<ShopOrder["items"]>(r.items),
  totalCents: BigInt(r.total_cents),
  totalSats: BigInt(r.total_sats),
  usdCentsPerBtc: BigInt(r.usd_cents_per_btc),
  bolt11: r.bolt11,
  paymentHash: r.payment_hash,
  state: r.state as ShopOrder["state"],
  createdAt: r.created_at,
  paidAt: r.paid_at ?? undefined,
  fulfilledAt: r.fulfilled_at ?? undefined,
  preimage: r.preimage ?? undefined,
  shippingSealed: r.shipping_sealed ?? undefined,
  contactSealed: r.contact_sealed ?? undefined,
  buyerKey: r.buyer_key ?? undefined,
  note: r.note ?? undefined,
})
const orderToRow = (o: ShopOrder): OrderRow => ({
  id: o.id,
  merchant_slug: o.merchantSlug,
  items: enc(o.items),
  total_cents: o.totalCents.toString(),
  total_sats: o.totalSats.toString(),
  usd_cents_per_btc: o.usdCentsPerBtc.toString(),
  bolt11: o.bolt11,
  payment_hash: o.paymentHash.toLowerCase(),
  state: o.state,
  created_at: o.createdAt,
  paid_at: o.paidAt ?? null,
  fulfilled_at: o.fulfilledAt ?? null,
  preimage: o.preimage ?? null,
  shipping_sealed: o.shippingSealed ?? null,
  contact_sealed: o.contactSealed ?? null,
  buyer_key: o.buyerKey ?? null,
  note: o.note ?? null,
})

async function q<T>(
  p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(`${what} failed: ${error.message}`)
  return data as T
}

export class SupabaseProductStore implements ProductStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  async get(merchantSlug: string, id: string) {
    const d = await q<ProductRow | null>(
      this.db
        .from("shop_products")
        .select("*")
        .eq("merchant_slug", merchantSlug)
        .eq("id", id)
        .maybeSingle(),
      "product read",
    )
    return d ? productFromRow(d) : null
  }
  async search(
    query: string,
    opts: { category?: ShopCategory; merchantSlug?: string; limit?: number } = {},
  ) {
    let s = this.db.from("shop_products").select("*").eq("in_stock", true)
    if (opts.category) s = s.eq("category", opts.category)
    if (opts.merchantSlug) s = s.eq("merchant_slug", opts.merchantSlug)
    const rows = await q<ProductRow[]>(s.limit(500), "product search")
    return rows
      .map(productFromRow)
      .filter((p) => productMatches(p, query))
      .slice(0, opts.limit ?? 50)
  }
  async listForMerchant(merchantSlug: string) {
    return (
      await q<ProductRow[]>(
        this.db.from("shop_products").select("*").eq("merchant_slug", merchantSlug),
        "product list",
      )
    ).map(productFromRow)
  }
  async deals(limit = 12) {
    const rows = await q<ProductRow[]>(
      this.db
        .from("shop_products")
        .select("*")
        .eq("in_stock", true)
        .not("deal_cents", "is", null)
        .limit(limit * 2),
      "deals",
    )
    return rows
      .map(productFromRow)
      .filter((p) => p.dealCents !== undefined && p.dealCents < p.priceCents)
      .slice(0, limit)
  }
  async upsert(p: ShopProduct) {
    if (!PRODUCT_ID_RE.test(p.id)) throw new Error(`bad product id: ${p.id}`)
    await q(
      this.db.from("shop_products").upsert({
        merchant_slug: p.merchantSlug,
        id: p.id,
        title: p.title,
        description: p.description ?? null,
        image_url: p.imageUrl ?? null,
        category: p.category,
        price_cents: p.priceCents.toString(),
        deal_cents: p.dealCents?.toString() ?? null,
        kind: p.kind,
        in_stock: p.inStock,
        ships_to: p.shipsTo ?? null,
      }),
      "product write",
    )
  }
  async remove(merchantSlug: string, id: string) {
    await q(
      this.db.from("shop_products").delete().eq("merchant_slug", merchantSlug).eq("id", id),
      "product delete",
    )
  }
}

export class SupabaseOrderStore implements OrderStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  async get(id: string) {
    const d = await q<OrderRow | null>(
      this.db.from("shop_orders").select("*").eq("id", id).maybeSingle(),
      "order read",
    )
    return d ? orderFromRow(d) : null
  }
  async getByPaymentHash(hash: string) {
    const d = await q<OrderRow | null>(
      this.db.from("shop_orders").select("*").eq("payment_hash", hash.toLowerCase()).maybeSingle(),
      "order read",
    )
    return d ? orderFromRow(d) : null
  }
  async listForMerchant(merchantSlug: string, limit = 50) {
    return (
      await q<OrderRow[]>(
        this.db
          .from("shop_orders")
          .select("*")
          .eq("merchant_slug", merchantSlug)
          .order("created_at", { ascending: false })
          .limit(limit),
        "orders",
      )
    ).map(orderFromRow)
  }
  async listForBuyer(buyerKey: string, limit = 50) {
    return (
      await q<OrderRow[]>(
        this.db
          .from("shop_orders")
          .select("*")
          .eq("buyer_key", buyerKey)
          .order("created_at", { ascending: false })
          .limit(limit),
        "orders",
      )
    ).map(orderFromRow)
  }
  async create(o: ShopOrder) {
    await q(this.db.from("shop_orders").insert(orderToRow(o)), "order create")
  }
  async update(o: ShopOrder) {
    await q(this.db.from("shop_orders").update(orderToRow(o)).eq("id", o.id), "order update")
  }
}

/** Operator seed: a JSON array of products. Merchant slugs must be recipients of kind "merchant". */
export function parseShopSeed(json: string): ShopProduct[] {
  const parsed = JSON.parse(json) as unknown
  if (!Array.isArray(parsed)) throw new Error("shop file must be a JSON array")
  return parsed.map((e, i) => {
    const x = e as Record<string, unknown>
    const id = String(x.id ?? "")
    if (!PRODUCT_ID_RE.test(id)) throw new Error(`product ${i}: bad id`)
    const merchantSlug = String(x.merchantSlug ?? "")
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(merchantSlug))
      throw new Error(`product ${id}: bad merchantSlug`)
    const category = String(x.category ?? "other") as ShopCategory
    if (!SHOP_CATEGORIES.includes(category)) throw new Error(`product ${id}: bad category`)
    const price = Number(x.priceCents)
    if (!Number.isInteger(price) || price < 0)
      throw new Error(`product ${id}: priceCents must be an integer`)
    const deal = x.dealCents === undefined || x.dealCents === null ? undefined : Number(x.dealCents)
    if (deal !== undefined && (!Number.isInteger(deal) || deal < 0))
      throw new Error(`product ${id}: dealCents must be an integer`)
    return {
      id,
      merchantSlug,
      title:
        String(x.title ?? "")
          .trim()
          .slice(0, 120) || id,
      description: x.description ? String(x.description).slice(0, 1000) : undefined,
      imageUrl: x.imageUrl ? String(x.imageUrl) : undefined,
      category,
      priceCents: BigInt(price),
      dealCents: deal === undefined ? undefined : BigInt(deal),
      kind: x.kind === "digital" ? "digital" : "physical",
      inStock: x.inStock !== false,
      shipsTo: Array.isArray(x.shipsTo) ? x.shipsTo.map(String) : undefined,
    }
  })
}

export async function seedShop(store: ProductStore, path: string): Promise<number> {
  const products = parseShopSeed(readFileSync(path, "utf8"))
  for (const p of products) await store.upsert(p)
  return products.length
}
