/**
 * DirectoryGoodsRail (M12): the storefront's merchants as a GoodsRail. Products come from the
 * product store; each order is ONE invoice minted by the merchant's own wallet (M10 receive side:
 * their existing Lightning address, or a sealed receive-only NWC connection). Shipping details
 * arrive already sealed and are stored for the merchant; this rail never opens them.
 */
import {
  type Cents,
  type GoodsRail,
  type Order,
  type OrderStore,
  type PriceSnapshot,
  type Product,
  type ProductStore,
  RailError,
  type Recipient,
  type ShopOrder,
  type ShopOrderItem,
  effectivePriceCents,
  globalProductId,
  orderTotalCents,
  parseGlobalProductId,
  satsForCents,
} from "@agentic-bitcoin/core"
import { type ReceiveSource, buildInvoice } from "../receive/lnurl"
import { decryptSecret } from "../secrets"

export type ReceiveWallet = Extract<ReceiveSource, { kind: "nwc" }>["wallet"] & { close?(): void }

export interface DirectoryGoodsRailOptions {
  products: ProductStore
  orders: OrderStore
  /** Merchant lookup: the recipient directory (merchants are recipients of kind "merchant"). */
  merchant(slug: string): Promise<Recipient | null>
  price(): Promise<PriceSnapshot | undefined>
  /** Needed only for merchants that paired a receive-only wallet connection. */
  secretsKey?: Buffer | null
  walletFor?(connectionString: string): ReceiveWallet
  fetchImpl?: typeof fetch
  now?: () => Date
  newId?: () => string
  /** Public site, for product links in search results. */
  siteUrl?: string
  /** Opaque buyer key recorded on orders created through this rail (chat purchases). */
  buyerKey?: string
}

let seq = 0
const defaultId = () => `ord_dir_${Date.now().toString(36)}_${(++seq).toString(36)}`

export class DirectoryGoodsRail implements GoodsRail {
  readonly kind = "directory"
  constructor(private readonly o: DirectoryGoodsRailOptions) {}

  async searchProducts(query: string): Promise<Product[]> {
    const found = await this.o.products.search(query, { limit: 20 })
    return found.map((p) => ({
      id: globalProductId(p.merchantSlug, p.id),
      name: `${p.title} — ${p.merchantSlug}`,
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

  /** One product, quantity 1 (the GoodsRail contract). The web checkout uses `createCartOrder`. */
  async createOrder(input: {
    productId: string
    usdCents: Cents
    shippingSealed?: string
    contactSealed?: string
  }): Promise<Order> {
    const parts = parseGlobalProductId(input.productId)
    if (!parts) throw new RailError(this.kind, "NOT_FOUND", input.productId)
    const p = await this.o.products.get(parts.merchantSlug, parts.id)
    if (!p || !p.inStock) throw new RailError(this.kind, "NOT_FOUND", input.productId)
    const unit = effectivePriceCents(p)
    if (unit !== input.usdCents)
      throw new RailError(
        this.kind,
        "AMOUNT_OUT_OF_RANGE",
        `price is ${unit} cents, not ${input.usdCents}`,
      )
    const order = await this.createCartOrder({
      merchantSlug: p.merchantSlug,
      items: [{ productId: p.id, title: p.title, qty: 1, priceCents: unit, kind: p.kind }],
      shippingSealed: input.shippingSealed,
      contactSealed: input.contactSealed,
    })
    return this.view(order)
  }

  /** The web cart: several items from ONE merchant → one invoice from that merchant's wallet. */
  async createCartOrder(input: {
    merchantSlug: string
    items: ShopOrderItem[]
    shippingSealed?: string
    contactSealed?: string
    buyerKey?: string
  }): Promise<ShopOrder> {
    if (!input.items.length) throw new RailError(this.kind, "REJECTED", "empty order")
    const merchant = await this.o.merchant(input.merchantSlug)
    if (!merchant || merchant.kind !== "merchant")
      throw new RailError(this.kind, "NOT_FOUND", `merchant ${input.merchantSlug}`)
    if (!merchant.verified)
      throw new RailError(this.kind, "REJECTED", "merchant is not verified yet")
    if (input.items.some((i) => i.kind === "physical") && !input.shippingSealed)
      throw new RailError(this.kind, "REJECTED", "physical goods need a shipping address")
    const price = await this.o.price()
    if (!price)
      throw new RailError(this.kind, "UNREACHABLE", "no price available to size the invoice")
    const totalCents = orderTotalCents(input.items)
    const totalSats = satsForCents(totalCents, price)
    const now = this.o.now ?? (() => new Date())
    const id = (this.o.newId ?? defaultId)()
    const source = this.sourceFor(merchant)
    try {
      const inv = await buildInvoice({
        name: merchant.name,
        source,
        amountMsats: Number(totalSats * 1000n), // money-ok: sats → msats at the LNURL boundary
        comment: `Order ${id}`,
        fetchImpl: (this.o.fetchImpl ?? fetch) as never,
      })
      const order: ShopOrder = {
        id,
        merchantSlug: merchant.slug,
        items: input.items,
        totalCents,
        totalSats,
        usdCentsPerBtc: price.usdCentsPerBtc,
        bolt11: inv.pr,
        paymentHash: inv.paymentHash.toLowerCase(),
        state: "unpaid",
        createdAt: now().toISOString(),
        shippingSealed: input.shippingSealed,
        contactSealed: input.contactSealed,
        buyerKey: input.buyerKey ?? this.o.buyerKey,
      }
      await this.o.orders.create(order)
      return order
    } finally {
      if (source.kind === "nwc") (source.wallet as { close?: () => void }).close?.()
    }
  }

  async getOrder(orderId: string): Promise<Order> {
    const o = await this.o.orders.get(orderId)
    if (!o) throw new RailError(this.kind, "NOT_FOUND", orderId)
    return this.view(o)
  }

  async markPaid(orderId: string, preimage: string): Promise<void> {
    const o = await this.o.orders.get(orderId)
    if (!o || o.state !== "unpaid") return
    const now = this.o.now ?? (() => new Date())
    await this.o.orders.update({ ...o, state: "paid", preimage, paidAt: now().toISOString() })
  }

  private view(o: ShopOrder): Order {
    const shipped = o.items.some((i) => i.kind === "physical")
    return {
      orderId: o.id,
      bolt11: o.bolt11,
      amountSats: o.totalSats,
      state: o.state === "fulfilled" ? "delivered" : o.state === "cancelled" ? "failed" : o.state,
      fulfilment: shipped ? "shipped" : "instant",
      paymentHash: o.paymentHash,
      // digital goods: the merchant's note (download link) is the "redemption"
      redemption: !shipped && o.state === "fulfilled" ? o.note : undefined,
    }
  }

  private sourceFor(m: Recipient): ReceiveSource {
    if (m.nwcReceive) {
      if (!this.o.secretsKey || !this.o.walletFor)
        throw new RailError(this.kind, "BAD_CONFIG", "merchant wallet connections need SECRETS_KEY")
      return {
        kind: "nwc",
        wallet: this.o.walletFor(decryptSecret(m.nwcReceive, this.o.secretsKey)),
      }
    }
    return { kind: "proxy", lightningAddress: m.lightningAddress }
  }
}

/**
 * One goods socket, many suppliers: directory products (`dir:` ids, `ord_dir_` orders) go to the
 * DirectoryGoodsRail; everything else to Bitrefill when the user has a key. Search merges both.
 */
export class CompositeGoodsRail implements GoodsRail {
  readonly kind = "goods"
  constructor(
    private readonly directory: DirectoryGoodsRail,
    private readonly bitrefill?: GoodsRail,
  ) {}
  private pick(id: string): GoodsRail {
    if (id.startsWith("dir:") || id.startsWith("ord_dir_")) return this.directory
    if (!this.bitrefill)
      throw new RailError(this.kind, "BAD_CONFIG", "no Bitrefill key: /key bitrefill <key>")
    return this.bitrefill
  }
  async searchProducts(query: string): Promise<Product[]> {
    const [a, b] = await Promise.all([
      this.directory.searchProducts(query),
      this.bitrefill
        ? this.bitrefill.searchProducts(query).catch(() => [] as Product[])
        : Promise.resolve([] as Product[]),
    ])
    return [...a, ...b]
  }
  async createOrder(input: Parameters<GoodsRail["createOrder"]>[0]) {
    return this.pick(input.productId).createOrder(input)
  }
  async getOrder(orderId: string) {
    return this.pick(orderId).getOrder(orderId)
  }
  async markPaid(orderId: string, preimage: string) {
    await this.pick(orderId).markPaid?.(orderId, preimage)
  }
}
