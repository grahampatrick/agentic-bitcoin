/**
 * Supabase storefront stores (M12), shared by the bot and the web. Prices as integer-cent strings;
 * orders carry a payment hash and SEALED shipping/contact blobs only.
 */
import { readFileSync } from "node:fs"
import {
  type InvoiceStore,
  type IssuedInvoice,
  type LightningAddressRecord,
  type LightningAddressStore,
  type OrderStore,
  PRODUCT_ID_RE,
  type ProductStore,
  type Reward,
  type RewardStore,
  SHOP_CATEGORIES,
  type ShopCategory,
  type ShopOrder,
  type ShopProduct,
  productMatches,
} from "@agentic-bitcoin/core"
import type { SupabaseClient } from "@supabase/supabase-js"

const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))
const dec = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x,
  ) as T

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
  reward_address?: string | null
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
  rewardAddress: r.reward_address ?? undefined,
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
  reward_address: o.rewardAddress ?? null,
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

// --- rewards (M13) ------------------------------------------------------------------------------

type RewardRow = {
  id: string
  user_id: string | null
  payout_address: string | null
  source: string
  merchant_slug: string | null
  order_id: string
  purchase_sats: string
  amount_sats: string
  bps: number
  state: string
  created_at: string
  payable_at: string
  paid_at: string | null
  payment_hash: string | null
  void_reason: string | null
}
const rewardFromRow = (r: RewardRow): Reward => ({
  id: r.id,
  userId: r.user_id ?? undefined,
  payoutAddress: r.payout_address ?? undefined,
  source: r.source as Reward["source"],
  merchantSlug: r.merchant_slug ?? undefined,
  orderId: r.order_id,
  purchaseSats: BigInt(r.purchase_sats),
  amountSats: BigInt(r.amount_sats),
  bps: r.bps,
  state: r.state as Reward["state"],
  createdAt: r.created_at,
  payableAt: r.payable_at,
  paidAt: r.paid_at ?? undefined,
  paymentHash: r.payment_hash ?? undefined,
  voidReason: r.void_reason ?? undefined,
})
const rewardToRow = (r: Reward): RewardRow => ({
  id: r.id,
  user_id: r.userId ?? null,
  payout_address: r.payoutAddress?.toLowerCase() ?? null,
  source: r.source,
  merchant_slug: r.merchantSlug ?? null,
  order_id: r.orderId,
  purchase_sats: r.purchaseSats.toString(),
  amount_sats: r.amountSats.toString(),
  bps: r.bps,
  state: r.state,
  created_at: r.createdAt,
  payable_at: r.payableAt,
  paid_at: r.paidAt ?? null,
  payment_hash: r.paymentHash ?? null,
  void_reason: r.voidReason ?? null,
})

export class SupabaseRewardStore implements RewardStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  async get(id: string) {
    const d = await q<RewardRow | null>(
      this.db.from("rewards").select("*").eq("id", id).maybeSingle(),
      "reward read",
    )
    return d ? rewardFromRow(d) : null
  }
  async getByOrder(orderId: string) {
    const d = await q<RewardRow | null>(
      this.db.from("rewards").select("*").eq("order_id", orderId).maybeSingle(),
      "reward read",
    )
    return d ? rewardFromRow(d) : null
  }
  async listForUser(userId: string) {
    return (
      await q<RewardRow[]>(this.db.from("rewards").select("*").eq("user_id", userId), "rewards")
    ).map(rewardFromRow)
  }
  async listForAddress(address: string) {
    return (
      await q<RewardRow[]>(
        this.db.from("rewards").select("*").eq("payout_address", address.toLowerCase()),
        "rewards",
      )
    ).map(rewardFromRow)
  }
  async listOpen() {
    return (
      await q<RewardRow[]>(
        this.db.from("rewards").select("*").in("state", ["pending", "payable"]),
        "rewards",
      )
    ).map(rewardFromRow)
  }
  async create(r: Reward) {
    const { error } = await this.db.from("rewards").insert(rewardToRow(r))
    if (error && error.code !== "23505") throw new Error(`reward write failed: ${error.message}`)
  }
  async update(r: Reward) {
    await q(this.db.from("rewards").update(rewardToRow(r)).eq("id", r.id), "reward update")
  }
}

// --- invoices (M14) -----------------------------------------------------------------------------

type InvoiceRow = {
  id: string
  number: string
  issuer: string
  issuer_name: string | null
  kind: string
  payer_name: string
  payer_contact_sealed: string | null
  items: string
  total_cents: string
  memo: string | null
  due_at: string | null
  state: string
  token: string
  bolt11: string | null
  payment_hash: string | null
  amount_sats: string | null
  usd_cents_per_btc: string | null
  minted_at: string | null
  expires_at: string | null
  created_at: string
  paid_at: string | null
  preimage: string | null
  paid_reported: boolean | null
  voided_at: string | null
}
const invoiceFromRow = (r: InvoiceRow): IssuedInvoice => ({
  id: r.id,
  number: r.number,
  issuer: r.issuer,
  issuerName: r.issuer_name ?? undefined,
  kind: r.kind as IssuedInvoice["kind"],
  payerName: r.payer_name,
  payerContactSealed: r.payer_contact_sealed ?? undefined,
  items: dec<IssuedInvoice["items"]>(r.items),
  totalCents: BigInt(r.total_cents),
  memo: r.memo ?? undefined,
  dueAt: r.due_at ?? undefined,
  state: r.state as IssuedInvoice["state"],
  token: r.token,
  bolt11: r.bolt11 ?? undefined,
  paymentHash: r.payment_hash ?? undefined,
  amountSats: r.amount_sats ? BigInt(r.amount_sats) : undefined,
  usdCentsPerBtc: r.usd_cents_per_btc ? BigInt(r.usd_cents_per_btc) : undefined,
  mintedAt: r.minted_at ?? undefined,
  expiresAt: r.expires_at ?? undefined,
  createdAt: r.created_at,
  paidAt: r.paid_at ?? undefined,
  preimage: r.preimage ?? undefined,
  paidReported: r.paid_reported ?? undefined,
  voidedAt: r.voided_at ?? undefined,
})
const invoiceToRow = (i: IssuedInvoice): InvoiceRow => ({
  id: i.id,
  number: i.number,
  issuer: i.issuer,
  issuer_name: i.issuerName ?? null,
  kind: i.kind,
  payer_name: i.payerName,
  payer_contact_sealed: i.payerContactSealed ?? null,
  items: enc(i.items),
  total_cents: i.totalCents.toString(),
  memo: i.memo ?? null,
  due_at: i.dueAt ?? null,
  state: i.state,
  token: i.token,
  bolt11: i.bolt11 ?? null,
  payment_hash: i.paymentHash?.toLowerCase() ?? null,
  amount_sats: i.amountSats?.toString() ?? null,
  usd_cents_per_btc: i.usdCentsPerBtc?.toString() ?? null,
  minted_at: i.mintedAt ?? null,
  expires_at: i.expiresAt ?? null,
  created_at: i.createdAt,
  paid_at: i.paidAt ?? null,
  preimage: i.preimage ?? null,
  paid_reported: i.paidReported ?? null,
  voided_at: i.voidedAt ?? null,
})

export class SupabaseInvoiceStore implements InvoiceStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  private async one(col: string, val: string) {
    const d = await q<InvoiceRow | null>(
      this.db.from("invoices").select("*").eq(col, val).maybeSingle(),
      "invoice read",
    )
    return d ? invoiceFromRow(d) : null
  }
  get(id: string) {
    return this.one("id", id)
  }
  getByToken(token: string) {
    return this.one("token", token)
  }
  getByPaymentHash(hash: string) {
    return this.one("payment_hash", hash.toLowerCase())
  }
  async listForIssuer(issuer: string, limit = 100) {
    return (
      await q<InvoiceRow[]>(
        this.db
          .from("invoices")
          .select("*")
          .eq("issuer", issuer)
          .order("created_at", { ascending: false })
          .limit(limit),
        "invoices",
      )
    ).map(invoiceFromRow)
  }
  async listOpenMinted() {
    return (
      await q<InvoiceRow[]>(
        this.db
          .from("invoices")
          .select("*")
          .eq("state", "open")
          .not("payment_hash", "is", null)
          .limit(500),
        "invoices",
      )
    ).map(invoiceFromRow)
  }
  async nextNumber(issuer: string) {
    const { count, error } = await this.db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("issuer", issuer)
    if (error) throw new Error(`invoice count failed: ${error.message}`)
    return `INV-${String((count ?? 0) + 1).padStart(4, "0")}`
  }
  async create(i: IssuedInvoice) {
    await q(this.db.from("invoices").insert(invoiceToRow(i)), "invoice create")
  }
  async update(i: IssuedInvoice) {
    await q(this.db.from("invoices").update(invoiceToRow(i)).eq("id", i.id), "invoice update")
  }
}

// --- lightning addresses (M15) ------------------------------------------------------------------

type AddressRow = {
  name: string
  user_id: string
  nwc_sealed: string | null
  forward_to: string | null
  created_at: string
}
const addrFromRow = (r: AddressRow): LightningAddressRecord => ({
  name: r.name,
  userId: r.user_id,
  nwcSealed: r.nwc_sealed ?? undefined,
  forwardTo: r.forward_to ?? undefined,
  createdAt: r.created_at,
})
const addrToRow = (r: LightningAddressRecord): AddressRow => ({
  name: r.name,
  user_id: r.userId,
  nwc_sealed: r.nwcSealed ?? null,
  forward_to: r.forwardTo ?? null,
  created_at: r.createdAt,
})

export class SupabaseLightningAddressStore implements LightningAddressStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  async get(name: string) {
    const d = await q<AddressRow | null>(
      this.db.from("lightning_addresses").select("*").eq("name", name.toLowerCase()).maybeSingle(),
      "address read",
    )
    return d ? addrFromRow(d) : null
  }
  async getForUser(userId: string) {
    const d = await q<AddressRow | null>(
      this.db.from("lightning_addresses").select("*").eq("user_id", userId).maybeSingle(),
      "address read",
    )
    return d ? addrFromRow(d) : null
  }
  async create(r: LightningAddressRecord) {
    const { error } = await this.db.from("lightning_addresses").insert(addrToRow(r))
    if (error)
      throw new Error(
        error.code === "23505" ? "name taken" : `address write failed: ${error.message}`,
      )
  }
  async update(r: LightningAddressRecord) {
    await q(
      this.db.from("lightning_addresses").update(addrToRow(r)).eq("name", r.name),
      "address update",
    )
  }
  async remove(name: string) {
    await q(this.db.from("lightning_addresses").delete().eq("name", name), "address delete")
  }
}

/** The bot's view of invoices our LNURL endpoint minted for addresses: settle them from the user's own wallet. */
export interface ReceiveInvoiceWatch {
  listUnsettled(
    slugPrefix: string,
    sinceIso: string,
    limit?: number,
  ): Promise<{ paymentHash: string; slug: string; amountMsats: number; comment?: string }[]>
  markSettled(paymentHash: string, settledAt: string, preimage?: string): Promise<void>
}

export class SupabaseReceiveInvoiceWatch implements ReceiveInvoiceWatch {
  constructor(private readonly db: SupabaseClient) {}
  async listUnsettled(slugPrefix: string, sinceIso: string, limit = 50) {
    const rows = await q<
      { payment_hash: string; slug: string; amount_msats: string; comment: string | null }[]
    >(
      this.db
        .from("receive_invoices")
        .select("payment_hash,slug,amount_msats,comment")
        .like("slug", `${slugPrefix}%`)
        .is("settled_at", null)
        .gte("created_at", sinceIso)
        .limit(limit),
      "receive invoices",
    )
    return rows.map((r) => ({
      paymentHash: r.payment_hash,
      slug: r.slug,
      amountMsats: Number(r.amount_msats),
      comment: r.comment ?? undefined,
    }))
  }
  async markSettled(paymentHash: string, settledAt: string, preimage?: string) {
    await q(
      this.db
        .from("receive_invoices")
        .update({ settled_at: settledAt, preimage: preimage ?? null })
        .eq("payment_hash", paymentHash),
      "receive settle",
    )
  }
}
