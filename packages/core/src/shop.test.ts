import { PRICE, SHOP } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import {
  InMemoryOrderStore,
  InMemoryProductStore,
  type ShopProduct,
  effectivePriceCents,
  globalProductId,
  groupCart,
  orderItemsFrom,
  orderTotalCents,
  parseGlobalProductId,
  preimageMatches,
  satsForCents,
} from "./shop"

const products = SHOP.products as unknown as ShopProduct[]
const by = (id: string) => products.find((p) => p.id === id) as ShopProduct

describe("product ids and prices", () => {
  it("round-trips global ids and rejects junk", () => {
    expect(globalProductId("reformation-books", "esv-study-bible")).toBe(
      "dir:reformation-books:esv-study-bible",
    )
    expect(parseGlobalProductId("dir:reformation-books:esv-study-bible")).toEqual({
      merchantSlug: "reformation-books",
      id: "esv-study-bible",
    })
    expect(parseGlobalProductId("gift-amazon-us")).toBeNull()
    expect(parseGlobalProductId("dir:Bad Slug:x")).toBeNull()
  })
  it("deal price wins only when lower", () => {
    expect(effectivePriceCents(by("esv-study-bible"))).toBe(39_99n)
    expect(effectivePriceCents({ priceCents: 10_00n, dealCents: 12_00n })).toBe(10_00n)
    expect(satsForCents(39_99n, PRICE)).toBe(48_082n)
    expect(satsForCents(0n, PRICE)).toBe(1n)
  })
})

describe("store search", () => {
  const store = new InMemoryProductStore(products)
  it("matches words across title, description, category and merchant; hides out-of-stock", async () => {
    expect((await store.search("study bible")).map((p) => p.id)).toEqual(["esv-study-bible"])
    expect((await store.search("books")).map((p) => p.id)).toEqual([
      "esv-study-bible",
      "psalms-commentary",
      "greek-syntax-ebook",
    ])
    expect((await store.search("", { category: "apparel" })).map((p) => p.id)).toEqual([
      "classic-tee",
      "evil-title",
    ])
    expect((await store.search("hymnal")).length).toBe(0)
    expect((await store.deals()).map((p) => p.id)).toEqual(["esv-study-bible", "classic-tee"])
  })
})

describe("cart maths", () => {
  it("groups by merchant, one invoice each, drops out-of-stock, flags shipping", () => {
    const groups = groupCart([
      { product: by("esv-study-bible"), qty: 2 },
      { product: by("greek-syntax-ebook"), qty: 1 },
      { product: by("classic-tee"), qty: 1 },
      { product: by("sold-out-hymnal"), qty: 1 },
    ])
    expect(groups.map((g) => g.merchantSlug)).toEqual(["reformation-books", "north-fork-apparel"])
    expect(groups[0]?.totalCents).toBe(39_99n * 2n + 19_99n)
    expect(groups[0]?.needsShipping).toBe(true)
    expect(groups[1]?.totalCents).toBe(19_00n)
    const items = orderItemsFrom(groups[0]?.lines ?? [])
    expect(items[0]).toMatchObject({
      productId: "esv-study-bible",
      qty: 2,
      priceCents: 39_99n,
      kind: "physical",
    })
    expect(orderTotalCents(items)).toBe(groups[0]?.totalCents)
    const digitalOnly = groupCart([{ product: by("greek-syntax-ebook"), qty: 1 }])
    expect(digitalOnly[0]?.needsShipping).toBe(false)
  })
})

describe("orders and proof", () => {
  it("preimage proves payment; order store finds by hash and buyer", async () => {
    const preimage = "ab".repeat(32)
    const { createHash } = await import("node:crypto")
    const hash = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex")
    expect(preimageMatches(preimage, hash.toUpperCase())).toBe(true)
    expect(preimageMatches("00".repeat(32), hash)).toBe(false)
    expect(preimageMatches("nothex", hash)).toBe(false)
    const orders = new InMemoryOrderStore()
    await orders.create({
      id: "o1",
      merchantSlug: "reformation-books",
      items: [],
      totalCents: 1n,
      totalSats: 1n,
      usdCentsPerBtc: PRICE.usdCentsPerBtc,
      bolt11: "lnbc1",
      paymentHash: hash.toUpperCase(),
      state: "unpaid",
      createdAt: "t",
      buyerKey: "b1",
    })
    expect((await orders.getByPaymentHash(hash))?.id).toBe("o1")
    expect((await orders.listForBuyer("b1")).length).toBe(1)
    await expect(
      orders.create({
        id: "o1",
        merchantSlug: "x",
        items: [],
        totalCents: 1n,
        totalSats: 1n,
        usdCentsPerBtc: 1n,
        bolt11: "",
        paymentHash: "h",
        state: "unpaid",
        createdAt: "t",
      }),
    ).rejects.toThrow()
  })
})
