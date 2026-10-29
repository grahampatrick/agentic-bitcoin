import { randomBytes } from "node:crypto"
/**
 * Storefront stores (M12): file-backed products and orders for a single operator. The Supabase
 * implementations and the seed parser live in @agentic-bitcoin/stores (shared with the web).
 */
import {
  type CardStore,
  type InvoiceStore,
  type IssuedInvoice,
  type LightningAddressRecord,
  type LightningAddressStore,
  type OrderStore,
  PRODUCT_ID_RE,
  type ProductStore,
  type Referral,
  type ReferralStore,
  type Reward,
  type RewardStore,
  type ShopCategory,
  type ShopOrder,
  type ShopProduct,
  type VirtualCard,
  type WebLink,
  type WebLinkStore,
  globalProductId,
  newReferralCode,
  productMatches,
} from "@agentic-bitcoin/core"
import type { FileState } from "./file"

export {
  SupabaseCardStore,
  SupabaseInvoiceStore,
  SupabaseLightningAddressStore,
  SupabaseReceiveInvoiceWatch,
  SupabaseOrderStore,
  SupabaseProductStore,
  SupabaseReferralStore,
  SupabaseRewardStore,
  SupabaseWebLinkStore,
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

/** M22: referral codes (`rc:<code>` → user, `ru:<user>` → code) and referrals (`rf:<friend>`) in the same bucket. */
export class FileReferralStore implements ReferralStore {
  readonly kind = "file"
  constructor(
    private readonly f: FileState,
    private readonly randomByte: () => number = () => randomBytes(1)[0] as number,
  ) {}
  async codeFor(userId: string) {
    const have = this.f.get("shop", `ru:${userId}`)
    if (have) return have
    let code = newReferralCode(this.randomByte)
    for (let tries = 0; this.f.get("shop", `rc:${code}`); tries++) {
      if (tries >= 20) throw new Error("could not mint an unused referral code")
      code = newReferralCode(this.randomByte)
    }
    this.f.set("shop", `rc:${code}`, userId)
    this.f.set("shop", `ru:${userId}`, code)
    return code
  }
  async userForCode(code: string) {
    return this.f.get("shop", `rc:${code}`)
  }
  async forFriend(friendId: string) {
    const v = this.f.get("shop", `rf:${friendId}`)
    return v ? dec<Referral>(v) : null
  }
  async listForReferrer(referrerId: string) {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("rf:"))
      .map((k) => dec<Referral>(this.f.get("shop", k) ?? ""))
      .filter((r) => r.referrerId === referrerId)
  }
  async create(r: Referral) {
    if (this.f.get("shop", `rf:${r.friendId}`)) return
    this.f.set("shop", `rf:${r.friendId}`, enc(r))
  }
  async update(r: Referral) {
    this.f.set("shop", `rf:${r.friendId}`, enc(r))
  }
}

/** M23: web links in the same file bucket, prefixed `wl:` (hash → link; never the token). */
export class FileWebLinkStore implements WebLinkStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  async userFor(tokenHash: string, now: Date) {
    const v = this.f.get("shop", `wl:${tokenHash}`)
    if (!v) return null
    const l = dec<WebLink>(v)
    return l.expiresAt <= now.toISOString() ? null : l.userId
  }
  async create(l: WebLink) {
    this.f.set("shop", `wl:${l.tokenHash}`, enc(l))
  }
  async listForUser(userId: string) {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("wl:"))
      .map((k) => dec<WebLink>(this.f.get("shop", k) ?? ""))
      .filter((l) => l.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }
  async revoke(tokenHash: string) {
    this.f.set("shop", `wl:${tokenHash}`, null)
  }
  async revokeAll(userId: string) {
    for (const l of await this.listForUser(userId)) this.f.set("shop", `wl:${l.tokenHash}`, null)
  }
}

/** M14: issued invoices in the same file bucket, prefixed `i:`. */
export class FileInvoiceStore implements InvoiceStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private all(): IssuedInvoice[] {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("i:"))
      .map((k) => dec<IssuedInvoice>(this.f.get("shop", k) ?? ""))
  }
  async get(id: string) {
    const v = this.f.get("shop", `i:${id}`)
    return v ? dec<IssuedInvoice>(v) : null
  }
  async getByToken(token: string) {
    return this.all().find((i) => i.token === token) ?? null
  }
  async getByPaymentHash(hash: string) {
    return this.all().find((i) => i.paymentHash === hash.toLowerCase()) ?? null
  }
  async listForIssuer(issuer: string, limit = 100) {
    return this.all()
      .filter((i) => i.issuer === issuer)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  }
  async listOpenMinted() {
    return this.all().filter((i) => i.state === "open" && !!i.paymentHash)
  }
  async nextNumber(issuer: string) {
    return `INV-${String(this.all().filter((i) => i.issuer === issuer).length + 1).padStart(4, "0")}`
  }
  async create(i: IssuedInvoice) {
    if (this.f.get("shop", `i:${i.id}`)) throw new Error("invoice exists")
    this.f.set("shop", `i:${i.id}`, enc({ ...i, paymentHash: i.paymentHash?.toLowerCase() }))
  }
  async update(i: IssuedInvoice) {
    this.f.set("shop", `i:${i.id}`, enc({ ...i, paymentHash: i.paymentHash?.toLowerCase() }))
  }
}

/** M15: lightning addresses in the file bucket, prefixed `a:`. (Only useful with the web on the same DB; kept for parity.) */
export class FileCardStore implements CardStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private all(): VirtualCard[] {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("c:"))
      .map((k) => dec<VirtualCard>(this.f.get("shop", k) ?? ""))
  }
  async get(id: string) {
    const v = this.f.get("shop", `c:${id}`)
    return v ? dec<VirtualCard>(v) : null
  }
  async listForUser(userId: string) {
    return this.all()
      .filter((c) => c.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async create(c: VirtualCard) {
    if (this.f.get("shop", `c:${c.id}`)) throw new Error("card exists")
    this.f.set("shop", `c:${c.id}`, enc(c))
  }
  async update(c: VirtualCard) {
    this.f.set("shop", `c:${c.id}`, enc(c))
  }
}

export class FileLightningAddressStore implements LightningAddressStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private all(): LightningAddressRecord[] {
    return this.f
      .keys("shop")
      .filter((k) => k.startsWith("a:"))
      .map((k) => dec<LightningAddressRecord>(this.f.get("shop", k) ?? ""))
  }
  async get(name: string) {
    const v = this.f.get("shop", `a:${name.toLowerCase()}`)
    return v ? dec<LightningAddressRecord>(v) : null
  }
  async getForUser(userId: string) {
    return this.all().find((r) => r.userId === userId) ?? null
  }
  async create(r: LightningAddressRecord) {
    if (this.f.get("shop", `a:${r.name}`)) throw new Error("name taken")
    this.f.set("shop", `a:${r.name}`, enc(r))
  }
  async update(r: LightningAddressRecord) {
    this.f.set("shop", `a:${r.name}`, enc(r))
  }
  async remove(name: string) {
    this.f.set("shop", `a:${name}`, null)
  }
}
