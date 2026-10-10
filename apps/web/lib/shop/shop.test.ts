import { createHash } from "node:crypto"
import { InMemoryOrderStore, InMemoryProductStore, type ShopProduct } from "@agentic-bitcoin/core"
import { PRICE, SHOP } from "@agentic-bitcoin/fixtures"
import { decryptSecret, encryptSecret, parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { hashToken } from "../receive/service"
import { InMemoryReceiveStore } from "../receive/store"
import {
  categoriesWithCounts,
  checkout,
  claimPaid,
  fulfilOrder,
  listMerchants,
  merchantOrders,
  orderStatus,
  upsertProduct,
  viewProducts,
} from "./service"

const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const NWC = `nostr+walletconnect://${"a".repeat(64)}?relay=wss://relay.example.com&secret=${"b".repeat(64)}`
const BASE = "https://agentic-bitcoin.vercel.app"
const now = () => new Date("2026-10-10T12:00:00.000Z")

function world() {
  const settled = new Set<string>()
  const receive = new InMemoryReceiveStore([
    {
      ...SHOP.merchants.books,
      nwcReceive: encryptSecret(NWC, KEY),
      dashboardTokenHash: hashToken("tok"),
    },
    { ...SHOP.merchants.apparel, verified: null }, // unverified: hidden and unbuyable
  ])
  const products = new InMemoryProductStore(SHOP.products as unknown as ShopProduct[])
  const orders = new InMemoryOrderStore()
  const deps = {
    products,
    orders,
    receive,
    price: async () => PRICE,
    baseUrl: BASE,
    secretsKey: KEY,
    now,
    walletFor: () => ({
      makeInvoice: async (i: { amountSats: bigint }) => ({
        bolt11: `lnbc${i.amountSats}minted`,
        paymentHash: `${i.amountSats}`.padStart(64, "0"),
        amountSats: i.amountSats,
        expiresAt: "",
      }),
      lookupInvoice: async (h: string) =>
        settled.has(h)
          ? { state: "settled" as const, preimage: "ab".repeat(32) }
          : { state: "pending" as const },
      close() {},
    }),
  }
  return { deps, products, orders, settled }
}

describe("catalogue views", () => {
  it("lists only verified merchants' products with sats and savings", async () => {
    const w = world()
    const v = await viewProducts(w.deps, await w.products.search(""))
    expect(v.map((p) => p.merchantSlug)).not.toContain("north-fork-apparel")
    const esv = v.find((p) => p.id === "esv-study-bible")
    expect(esv).toMatchObject({
      gid: "dir:reformation-books:esv-study-bible",
      payCents: 3999,
      saveCents: 1000,
      merchantName: "Reformation Books",
      paySats: 48082,
    })
    expect((await listMerchants(w.deps)).map((m) => m.slug)).toEqual(["reformation-books"])
    expect(await categoriesWithCounts(w.deps)).toEqual([
      { category: "books", count: 3 },
      { category: "apparel", count: 2 },
    ])
  })
})

describe("checkout and settlement", () => {
  it("one invoice from the merchant's wallet; shipping sealed; status flips to paid when the wallet sees settlement", async () => {
    const w = world()
    const bad = await checkout(w.deps, {
      merchantSlug: "reformation-books",
      items: [{ productId: "esv-study-bible", qty: 1 }],
    })
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("Shipping") })
    const r = await checkout(w.deps, {
      merchantSlug: "reformation-books",
      items: [
        { productId: "esv-study-bible", qty: 2 },
        { productId: "greek-syntax-ebook", qty: 1 },
      ],
      shipping: {
        name: "Graham",
        address: "1 Main St",
        city: "Denver",
        region: "CO",
        postal: "80202",
        country: "us",
      },
      contact: "g@example.com",
      buyerKey: "b1",
    })
    expect(r).toMatchObject({
      ok: true,
      totalCents: 9997,
      bolt11: expect.stringMatching(/^lnbc\d+minted$/),
    })
    const id = (r as { orderId: string }).orderId
    const stored = await w.orders.get(id)
    expect(
      JSON.stringify(stored, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    ).not.toContain("Main St")
    expect(JSON.parse(decryptSecret(stored?.shippingSealed ?? "", KEY))).toMatchObject({
      city: "Denver",
      country: "US",
    })
    let s = await orderStatus(w.deps, id)
    expect(s).toMatchObject({
      state: "unpaid",
      canVerify: true,
      hasShipping: true,
      merchantName: "Reformation Books",
    })
    w.settled.add(stored?.paymentHash ?? "")
    s = await orderStatus(w.deps, id)
    expect(s?.state).toBe("paid")
    expect((await w.orders.get(id))?.preimage).toBe("ab".repeat(32))
  })
  it("a buyer can prove payment with the preimage; unverified merchants cannot sell", async () => {
    const w = world()
    const r = await checkout(w.deps, {
      merchantSlug: "reformation-books",
      items: [{ productId: "greek-syntax-ebook", qty: 1 }],
    })
    const id = (r as { orderId: string }).orderId
    const hash = (await w.orders.get(id))?.paymentHash ?? ""
    expect(await claimPaid(w.deps, id, "00".repeat(32))).toMatchObject({ ok: false })
    // the fake wallet's hash is not sha256 of anything we know; build an order whose hash we do know
    const preimage = "cd".repeat(32)
    const real = createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex")
    const o = await w.orders.get(id)
    if (o) await w.orders.update({ ...o, paymentHash: real })
    void hash
    expect(await claimPaid(w.deps, id, preimage.toUpperCase())).toEqual({ ok: true })
    expect((await orderStatus(w.deps, id))?.state).toBe("paid")
    expect(
      await checkout(w.deps, {
        merchantSlug: "north-fork-apparel",
        items: [{ productId: "classic-tee", qty: 1 }],
        shipping: { name: "a", address: "b", city: "c", country: "US" },
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("not verified") })
  })
})

describe("merchant tools", () => {
  it("products are managed with the dashboard token; orders show decrypted shipping to the merchant only; fulfil needs paid", async () => {
    const w = world()
    expect(
      await upsertProduct(w.deps, "reformation-books", "nope", {
        title: "X",
        category: "books",
        price: "1",
        kind: "digital",
      }),
    ).toMatchObject({ ok: false })
    const added = await upsertProduct(w.deps, "reformation-books", "tok", {
      title: "Pocket Psalter",
      category: "books",
      price: "12.50",
      deal: "9.99",
      kind: "physical",
      description: "Cloth.",
    })
    expect(added).toEqual({ ok: true, id: "pocket-psalter" })
    expect(await w.products.get("reformation-books", "pocket-psalter")).toMatchObject({
      priceCents: 12_50n,
      dealCents: 9_99n,
      inStock: true,
    })
    expect(
      await upsertProduct(w.deps, "reformation-books", "tok", {
        title: "Bad",
        category: "books",
        price: "abc",
        kind: "digital",
      }),
    ).toMatchObject({ ok: false })

    const r = await checkout(w.deps, {
      merchantSlug: "reformation-books",
      items: [{ productId: "pocket-psalter", qty: 1 }],
      shipping: { name: "Graham", address: "1 Main St", city: "Denver", country: "US" },
    })
    const id = (r as { orderId: string }).orderId
    expect(await fulfilOrder(w.deps, "reformation-books", "tok", id, "shipped")).toMatchObject({
      ok: false,
      error: expect.stringContaining("paid"),
    })
    const o = await w.orders.get(id)
    if (o) await w.orders.update({ ...o, state: "paid" })
    const list = await merchantOrders(w.deps, "reformation-books", "tok")
    expect(list?.[0]?.shipping).toMatchObject({ name: "Graham", city: "Denver" })
    expect(await merchantOrders(w.deps, "reformation-books", "wrong")).toBeNull()
    expect(await fulfilOrder(w.deps, "reformation-books", "tok", id, "USPS 9400...")).toEqual({
      ok: true,
    })
    expect(await orderStatus(w.deps, id)).toMatchObject({
      state: "fulfilled",
      note: "USPS 9400...",
    })
  })
})
