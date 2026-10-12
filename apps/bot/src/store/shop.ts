/**
 * Storefront stores (M12): file-backed products and orders for a single operator. The Supabase
 * implementations and the seed parser live in @agentic-bitcoin/stores (shared with the web).
 */
import {
  type OrderStore,
  PRODUCT_ID_RE,
  type ProductStore,
  type Reward,
  type RewardStore,
  type ShopCategory,
  type ShopOrder,
  type ShopProduct,
  globalProductId,
  productMatches,
} from "@agentic-bitcoin/core"
import type { FileState } from "./file"

export {
  SupabaseOrderStore,
  SupabaseProductStore,
  SupabaseRewardStore,
  parseShopSeed,
  seedShop,
} from "@agentic-bitcoin/stores"

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

/** M13: rewards in the same file bucket, prefixed `r:`. */
export class FileRewardStore implements RewardStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private all(): Reward[] {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("r:"))
      .map((k) => dec<Reward>(this.f.get("shop", k) ?? ""))
  }
  async get(id: string) {
    const v = this.f.get("shop", `r:${id}`)
    return v ? dec<Reward>(v) : null
  }
  async getByOrder(orderId: string) {
    return this.all().find((r) => r.orderId === orderId) ?? null
  }
  async listForUser(userId: string) {
    return this.all().filter((r) => r.userId === userId)
  }
  async listForAddress(address: string) {
    return this.all().filter((r) => r.payoutAddress?.toLowerCase() === address.toLowerCase())
  }
  async listOpen() {
    return this.all().filter((r) => r.state === "pending" || r.state === "payable")
  }
  async create(r: Reward) {
    if (await this.getByOrder(r.orderId)) return
    this.f.set("shop", `r:${r.id}`, enc(r))
  }
  async update(r: Reward) {
    this.f.set("shop", `r:${r.id}`, enc(r))
  }
}
