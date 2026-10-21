import { createHash } from "node:crypto"
import {
  DEFAULT_REWARD_RATES,
  InMemoryOrderStore,
  InMemoryProductStore,
  InMemoryRewardStore,
  type ShopProduct,
  rewardSink,
} from "@agentic-bitcoin/core"
import { PRICE, SHOP, TCG } from "@agentic-bitcoin/fixtures"
import { decryptSecret, encryptSecret, parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { hashToken } from "../receive/service"
import { InMemoryReceiveStore } from "../receive/store"
import {
  categoriesWithCounts,
  checkout,
  claimPaid,
  feedFor,
  fulfilOrder,
  importForMerchant,
  listMerchants,
  manifestOf,
  merchantOrders,
  orderStatus,
  rewardsForAddress,
  syncRemoteShop,
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
  const rewardStore = new InMemoryRewardStore()
  let rw = 0
  const deps = {
    products,
    orders,
    receive,
    rewardStore,
    rewards: rewardSink(rewardStore, DEFAULT_REWARD_RATES, () => `rw_${++rw}`),
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
  return { deps, products, orders, settled, rewardStore }
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

describe("sats-back on web orders (M13)", () => {
  it("a paid order with a reward address earns 1%, once, visible by address; no address earns nothing", async () => {
    const w = world()
    const r = await checkout(w.deps, {
      merchantSlug: "reformation-books",
      items: [{ productId: "greek-syntax-ebook", qty: 1 }],
      rewardAddress: "Me@getalby.com",
    })
    expect(r).toMatchObject({ ok: true })
    const id = (r as { orderId: string }).orderId
    expect(
      await checkout(w.deps, {
        merchantSlug: "reformation-books",
        items: [{ productId: "greek-syntax-ebook", qty: 1 }],
        rewardAddress: "nope",
      }),
    ).toMatchObject({ ok: false })
    w.settled.add((await w.orders.get(id))?.paymentHash ?? "")
    await orderStatus(w.deps, id)
    await orderStatus(w.deps, id) // idempotent
    const sum = await rewardsForAddress(w.deps, "me@getalby.com")
    expect(sum?.count).toBe(1)
    expect(sum?.rewards[0]).toMatchObject({
      orderId: id,
      amountSats: (Number((await w.orders.get(id))?.totalSats ?? 0n) / 100) | 0,
      state: "pending",
    })
    const none = await checkout(w.deps, {
      merchantSlug: "reformation-books",
      items: [{ productId: "greek-syntax-ebook", qty: 1 }],
    })
    const id2 = (none as { orderId: string }).orderId
    w.settled.add((await w.orders.get(id2))?.paymentHash ?? "")
    await orderStatus(w.deps, id2)
    expect(await w.rewardStore.getByOrder(id2)).toBeNull()
  })
})

describe("remote shops and the protocol (M16)", () => {
  const remoteFetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    if (u.pathname === "/.well-known/anvard.json")
      return { ok: true, status: 200, json: async () => TCG.manifest }
    if (u.pathname === "/anvard/products")
      return { ok: true, status: 200, json: async () => TCG.feed }
    if (u.pathname === "/anvard/checkout") {
      const body = JSON.parse(String(init?.body)) as { shipping?: { city: string } }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          anvard: "0.1",
          orderId: "cc-9",
          bolt11: "lnbc1remote",
          paymentHash: "c".repeat(64),
          amountSats: 505_000,
          expiresAt: "2026-10-21T00:10:00Z",
          fulfilment: "shipped",
          echo: body.shipping?.city,
        }),
      }
    }
    if (u.pathname === "/anvard/orders/cc-9")
      return {
        ok: true,
        status: 200,
        json: async () => ({
          anvard: "0.1",
          orderId: "cc-9",
          state: "paid",
          paymentHash: "c".repeat(64),
        }),
      }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
  it("connect a shop by host: manifest checked, feed synced into the catalogue, checkout goes to the shop, status follows it", async () => {
    const w = world()
    await w.deps.receive.createRecipient({
      slug: "cardboard-castle",
      kind: "merchant",
      name: "Cardboard Castle",
      lightningAddress: "pay@cc.example",
      verified: { how: "operator", at: "t" },
      dashboardTokenHash: hashToken("cc"),
    })
    const deps = { ...w.deps, fetchImpl: remoteFetch }
    const bad = await importForMerchant(deps, "cardboard-castle", "cc", {
      manifestHost: "https://cardboard-castle.example/",
    })
    expect(bad).toMatchObject({ ok: true, imported: 3, remote: true })
    expect((await w.deps.receive.getRecipient("cardboard-castle"))?.manifestHost).toBe(
      "cardboard-castle.example",
    )
    const listed = await viewProducts(deps, await w.products.listForMerchant("cardboard-castle"))
    expect(listed.map((p) => p.id)).toEqual([
      "charizard-base-4-102-lp",
      "black-lotus-proxy",
      "booster-box-obf",
    ])
    expect(listed[0]).toMatchObject({ remote: true, tcg: { game: "pokemon", condition: "LP" } })
    const r = await checkout(deps, {
      merchantSlug: "cardboard-castle",
      items: [{ productId: "charizard-base-4-102-lp", qty: 1 }],
      shipping: { name: "G", address: "1 Main", city: "Denver", country: "US" },
    })
    expect(r).toMatchObject({ ok: true, bolt11: "lnbc1remote", totalSats: 505_000 })
    const id = (r as { orderId: string }).orderId
    expect(id).toBe("rm_cardboard-castle-cc-9")
    const st = await orderStatus(deps, id)
    expect(st?.state).toBe("paid")
    expect(await syncRemoteShop(deps, "reformation-books")).toMatchObject({ ok: false })
  })
  it("our directory merchants are served as manifests and feeds any agent can read", async () => {
    const w = world()
    const m = await manifestOf(w.deps, "reformation-books")
    expect(m).toMatchObject({
      anvard: "0.1",
      merchant: { slug: "reformation-books", name: "Reformation Books" },
      endpoints: {
        checkout: "https://agentic-bitcoin.vercel.app/api/commerce/reformation-books/checkout",
      },
    })
    const f = await feedFor(w.deps, "reformation-books")
    expect(f?.products.find((p) => p.id === "esv-study-bible")).toMatchObject({
      priceCents: 4999,
      dealCents: 3999,
      kind: "physical",
    })
    expect(await manifestOf(w.deps, "north-fork-apparel")).toBeNull() // unverified
  })
  it("CSV and Shopify imports land in the merchant's catalogue with the dashboard token", async () => {
    const w = world()
    const r = await importForMerchant(w.deps, "reformation-books", "tok", {
      csv: TCG.csv,
      defaultGame: "pokemon",
      replace: true,
    })
    expect(r).toMatchObject({ ok: true, imported: 3 })
    const all = await w.products.listForMerchant("reformation-books")
    expect(all.map((p) => p.id).sort()).toEqual(["42", "43", "44"])
    expect(all.find((p) => p.id === "42")?.tcg?.set).toBe("Base Set")
    expect(
      await importForMerchant(w.deps, "reformation-books", "wrong", { csv: TCG.csv }),
    ).toMatchObject({ ok: false })
  })
})
