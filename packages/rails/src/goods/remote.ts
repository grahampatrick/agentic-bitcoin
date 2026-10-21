/**
 * RemoteMerchantRail (M16): any merchant that speaks the Anvard commerce protocol becomes a
 * GoodsRail. The feed is fetched and cached briefly; checkout posts to the merchant and gets THEIR
 * BOLT11; status is read from them. We never hold money and never see the invoice's preimage before
 * the payer does.
 */
import {
  type Cents,
  type CheckoutRequest,
  type GoodsRail,
  type MerchantManifest,
  type Order,
  type PriceSnapshot,
  type Product,
  RailError,
  type Sats,
  type ShopProduct,
  effectivePriceCents,
  parseCheckoutResponse,
  parseFeed,
  parseManifest,
  parseOrderStatus,
  parseRemoteProductId,
  remoteProductId,
  satsToCents,
} from "@agentic-bitcoin/core"

type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface RemoteMerchantRailOptions {
  manifest: MerchantManifest
  price(): Promise<PriceSnapshot | undefined>
  fetchImpl?: FetchLike
  now?: () => Date
  /** Feed cache TTL. */
  ttlMs?: number
  siteUrl?: string
  /** Opaque buyer reference echoed by the merchant; never personal data. */
  buyerRef?: string
}

export async function fetchManifest(
  host: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<MerchantManifest> {
  const res = await fetchImpl(`https://${host}/.well-known/anvard.json`, {
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok)
    throw new RailError("remote", "UNREACHABLE", `${host}: HTTP ${res.status} for the manifest`)
  return parseManifest(await res.json(), host)
}

export class RemoteMerchantRail implements GoodsRail {
  readonly kind: string
  private cache: { at: number; products: ShopProduct[] } | null = null
  constructor(private readonly o: RemoteMerchantRailOptions) {
    this.kind = `remote:${o.manifest.merchant.slug}`
  }
  get slug() {
    return this.o.manifest.merchant.slug
  }
  private get fetchImpl(): FetchLike {
    return this.o.fetchImpl ?? (fetch as unknown as FetchLike)
  }

  async products(): Promise<ShopProduct[]> {
    const now = (this.o.now ?? (() => new Date()))().getTime()
    if (this.cache && now - this.cache.at < (this.o.ttlMs ?? 60_000)) return this.cache.products
    const price = await this.o.price()
    const res = await this.fetchImpl(this.o.manifest.endpoints.products, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new RailError(this.kind, "UNREACHABLE", `feed HTTP ${res.status}`)
    const products = parseFeed(await res.json(), this.slug, (s: Sats) => {
      if (!price) throw new RailError(this.kind, "UNREACHABLE", "no price to convert sats prices")
      return satsToCents(s, price)
    })
    this.cache = { at: now, products }
    return products
  }

  async searchProducts(query: string): Promise<Product[]> {
    const { productMatches } = await import("@agentic-bitcoin/core")
    return (await this.products())
      .filter((p) => p.inStock && productMatches(p, query))
      .slice(0, 20)
      .map((p) => ({
        id: remoteProductId(p.merchantSlug, p.id),
        name: `${p.title} — ${this.o.manifest.merchant.name}`,
        usdCents: effectivePriceCents(p),
        merchant: p.merchantSlug,
        kind: p.kind,
        imageUrl: p.imageUrl,
        category: p.category,
        url: this.o.siteUrl
          ? `${this.o.siteUrl.replace(/\/$/, "")}/shop/p/${p.merchantSlug}/${p.id}`
          : undefined,
      }))
  }

  async createOrder(input: {
    productId: string
    usdCents: Cents
    shippingSealed?: string
    contactSealed?: string
  }): Promise<Order> {
    const parts = parseRemoteProductId(input.productId)
    if (!parts || parts.merchantSlug !== this.slug)
      throw new RailError(this.kind, "NOT_FOUND", input.productId)
    const p = (await this.products()).find((x) => x.id === parts.id && x.inStock)
    if (!p) throw new RailError(this.kind, "NOT_FOUND", input.productId)
    const unit = effectivePriceCents(p)
    if (unit !== input.usdCents)
      throw new RailError(
        this.kind,
        "AMOUNT_OUT_OF_RANGE",
        `price is ${unit} cents, not ${input.usdCents}`,
      )
    // Sealed shipping cannot be opened here (we never hold the key in this path): remote merchants
    // need plain shipping over HTTPS, which the web checkout provides via createRemoteOrder.
    if (p.kind === "physical" && !input.shippingSealed)
      throw new RailError(this.kind, "REJECTED", "physical goods need a shipping address")
    if (p.kind === "physical")
      throw new RailError(
        this.kind,
        "REJECTED",
        "chat purchases of physical goods from remote shops land in M16.1 (shipping must be sent to the shop in plain text over HTTPS)",
      )
    return this.createRemoteOrder({ items: [{ productId: p.id, qty: 1 }] })
  }

  /** The web checkout path: items (+ plain shipping sent straight to the shop) → the shop's BOLT11. */
  async createRemoteOrder(req: Omit<CheckoutRequest, "anvard">): Promise<Order> {
    const body: CheckoutRequest = {
      anvard: "0.1",
      ...req,
      buyerRef: req.buyerRef ?? this.o.buyerRef,
    }
    let res: Awaited<ReturnType<FetchLike>>
    try {
      res = await this.fetchImpl(this.o.manifest.endpoints.checkout, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      throw new RailError(this.kind, "UNREACHABLE", (err as Error).message)
    }
    if (!res.ok)
      throw new RailError(
        this.kind,
        res.status === 404 ? "NOT_FOUND" : "REJECTED",
        `checkout HTTP ${res.status}`,
      )
    const c = parseCheckoutResponse(await res.json())
    return {
      orderId: `${this.slug}/${c.orderId}`,
      bolt11: c.bolt11,
      amountSats: BigInt(c.amountSats),
      state: "unpaid",
      fulfilment: c.fulfilment,
      paymentHash: c.paymentHash,
    }
  }

  async getOrder(orderId: string): Promise<Order> {
    const id = orderId.startsWith(`${this.slug}/`) ? orderId.slice(this.slug.length + 1) : orderId
    const res = await this.fetchImpl(
      this.o.manifest.endpoints.order.replace("{id}", encodeURIComponent(id)),
      { signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) throw new RailError(this.kind, "NOT_FOUND", orderId)
    const s = parseOrderStatus(await res.json())
    const state: Order["state"] =
      s.state === "fulfilled" ? "delivered" : s.state === "cancelled" ? "failed" : s.state
    return {
      orderId,
      bolt11: "",
      amountSats: 0n,
      state,
      paymentHash: s.paymentHash,
      redemption: s.redemption,
    }
  }
}
