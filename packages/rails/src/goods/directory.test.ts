import {
  FakeGoodsRail,
  InMemoryOrderStore,
  InMemoryProductStore,
  type Recipient,
  type ShopProduct,
} from "@agentic-bitcoin/core"
import { PRICE, SHOP, SPEC_INVOICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { describeGoodsRail } from "../../../core/test/rail-contract"
import { encryptSecret, parseKey } from "../secrets"
import { CompositeGoodsRail, DirectoryGoodsRail } from "./directory"

const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const NWC = `nostr+walletconnect://${"a".repeat(64)}?relay=wss://relay.example.com&secret=${"b".repeat(64)}`
const proxyMerchants = Object.values(SHOP.merchants) as unknown as Recipient[]
/** By default every merchant has a receive-only wallet connection: the fake wallet mints any amount. */
const merchants: Recipient[] = proxyMerchants.map((m) => ({
  ...m,
  nwcReceive: encryptSecret(NWC, KEY),
}))
const products = SHOP.products as unknown as ShopProduct[]
const walletFor = () => ({
  makeInvoice: async (i: { amountSats: bigint; memo: string }) => ({
    bolt11: `lnbc${i.amountSats}minted`,
    paymentHash: `${i.amountSats}`.padStart(64, "0"),
    amountSats: i.amountSats,
    expiresAt: "",
  }),
  close() {},
})

/** Upstream LNURL for a proxied merchant: always answers with the 250k-sat spec invoice. */
const fetchImpl = (async (url: string) => {
  const u = new URL(url)
  if (u.pathname === "/.well-known/lnurlp/pay")
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag: "payRequest",
        callback: "https://reformation-books.example/cb",
        minSendable: 1000,
        maxSendable: 1_000_000_000_000,
        metadata: "[]",
        commentAllowed: 100,
      }),
    }
  if (u.pathname === "/cb")
    return { ok: true, status: 200, json: async () => ({ pr: SPEC_INVOICE.bolt11 }) }
  return { ok: false, status: 404, json: async () => ({}) }
}) as unknown as typeof fetch

type Opts = ConstructorParameters<typeof DirectoryGoodsRail>[0]
function make(over: Partial<Opts> = {}) {
  const store = new InMemoryProductStore(products)
  const orders = new InMemoryOrderStore()
  // a price at which the ESV deal ($39.99) is exactly 250,000 sats
  const price = { ...PRICE, usdCentsPerBtc: (39_99n * 100_000_000n) / 250_000n }
  const rail = new DirectoryGoodsRail({
    products: store,
    orders,
    merchant: async (slug) => merchants.find((m) => m.slug === slug) ?? null,
    price: async () => price,
    fetchImpl,
    secretsKey: KEY,
    walletFor,
    now: () => new Date("2026-10-10T12:00:00.000Z"),
    siteUrl: "https://agentic-bitcoin.vercel.app",
    buyerKey: "buyer1",
    ...over,
  })
  return { rail, store, orders }
}
const proxied = (slug: string) => proxyMerchants.find((m) => m.slug === slug) ?? null

describeGoodsRail("DirectoryGoodsRail", () => make().rail, {
  query: "study bible",
  productId: "dir:reformation-books:greek-syntax-ebook",
  usdCents: 19_99n,
})

describe("DirectoryGoodsRail", () => {
  it("search returns global ids, deal prices, kinds and store links", async () => {
    const { rail } = make()
    expect(await rail.searchProducts("study bible")).toEqual([
      {
        id: "dir:reformation-books:esv-study-bible",
        name: "ESV Study Bible — reformation-books",
        usdCents: 39_99n,
        merchant: "reformation-books",
        kind: "physical",
        imageUrl: "https://reformation-books.example/img/esv.jpg",
        category: "books",
        url: "https://agentic-bitcoin.vercel.app/shop/p/reformation-books/esv-study-bible",
      },
    ])
  })
  it("physical goods need sealed shipping; the invoice is minted in the merchant's wallet; paid is terminal for shipped goods", async () => {
    const { rail, orders } = make()
    const gid = "dir:reformation-books:esv-study-bible"
    await expect(rail.createOrder({ productId: gid, usdCents: 39_99n })).rejects.toMatchObject({
      code: "REJECTED",
    })
    await expect(
      rail.createOrder({ productId: gid, usdCents: 49_99n, shippingSealed: "s" }),
    ).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" })
    const o = await rail.createOrder({
      productId: gid,
      usdCents: 39_99n,
      shippingSealed: "sealed-blob",
    })
    expect(o).toMatchObject({
      bolt11: "lnbc250000minted",
      amountSats: 250_000n,
      state: "unpaid",
      fulfilment: "shipped",
    })
    const stored = await orders.get(o.orderId)
    expect(stored).toMatchObject({
      merchantSlug: "reformation-books",
      totalCents: 39_99n,
      shippingSealed: "sealed-blob",
      buyerKey: "buyer1",
    })
    expect(stored?.paymentHash).toBe("250000".padStart(64, "0"))
    await rail.markPaid(o.orderId, "p".repeat(64))
    expect((await rail.getOrder(o.orderId)).state).toBe("paid")
    expect((await orders.get(o.orderId))?.preimage).toBe("p".repeat(64))
  })
  it("refuses unverified merchants; a proxied merchant's invoice must match the amount asked", async () => {
    const unverified = make({
      merchant: async (slug) => ({ ...(merchants[0] as Recipient), slug, verified: null }),
    })
    await expect(
      unverified.rail.createOrder({
        productId: "dir:reformation-books:greek-syntax-ebook",
        usdCents: 19_99n,
      }),
    ).rejects.toMatchObject({ code: "REJECTED" })
    const proxy = make({ merchant: async (slug) => proxied(slug) })
    const ok = await proxy.rail.createOrder({
      productId: "dir:reformation-books:esv-study-bible",
      usdCents: 39_99n,
      shippingSealed: "s",
    })
    expect(ok.bolt11).toBe(SPEC_INVOICE.bolt11)
    expect(ok.paymentHash).toBe(SPEC_INVOICE.paymentHash)
    const bad = make({ merchant: async (slug) => proxied(slug), price: async () => PRICE })
    await expect(
      bad.rail.createOrder({
        productId: "dir:reformation-books:greek-syntax-ebook",
        usdCents: 19_99n,
      }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })
  it("a cart from one merchant is one invoice", async () => {
    const { rail } = make({
      price: async () => ({
        ...PRICE,
        usdCentsPerBtc: ((39_99n + 19_99n) * 100_000_000n) / 250_000n,
      }),
    })
    const o = await rail.createCartOrder({
      merchantSlug: "reformation-books",
      items: [
        {
          productId: "esv-study-bible",
          title: "ESV Study Bible",
          qty: 1,
          priceCents: 39_99n,
          kind: "physical",
        },
        {
          productId: "greek-syntax-ebook",
          title: "Greek Syntax (ebook)",
          qty: 1,
          priceCents: 19_99n,
          kind: "digital",
        },
      ],
      shippingSealed: "s",
    })
    expect(o.totalCents).toBe(59_98n)
    expect(o.totalSats).toBe(250_000n)
    expect(o.bolt11).toBe("lnbc250000minted")
  })
})

describe("CompositeGoodsRail", () => {
  it("routes by id prefix and merges search; no Bitrefill key is a clear error", async () => {
    const both = new CompositeGoodsRail(make().rail, new FakeGoodsRail())
    expect((await both.searchProducts("amazon")).map((p) => p.id)).toEqual(["gift-amazon-us"])
    expect((await both.searchProducts("study bible"))[0]?.id).toBe(
      "dir:reformation-books:esv-study-bible",
    )
    const o = await both.createOrder({ productId: "topup-mint-10", usdCents: 10_00n })
    expect(o.orderId.startsWith("ord_fake_")).toBe(true)
    const none = new CompositeGoodsRail(make().rail)
    await expect(
      none.createOrder({ productId: "topup-mint-10", usdCents: 10_00n }),
    ).rejects.toMatchObject({ code: "BAD_CONFIG" })
    expect((await none.searchProducts("amazon")).length).toBe(0)
  })
})
