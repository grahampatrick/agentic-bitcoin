import { PRICE, TCG } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import {
  ProtocolError,
  parseCheckoutResponse,
  parseFeed,
  parseManifest,
  parseOrderStatus,
  parseRemoteProductId,
  remoteProductId,
} from "./commerce"
import { satsToCents } from "./money"
import { importProductsCsv, importShopifyProducts, parseCsv } from "./shopimport"

const toCents = (s: bigint) => satsToCents(s, PRICE)

describe("protocol parsing", () => {
  it("manifest: slug, name, https endpoints; relative endpoints resolve against the host", () => {
    const m = parseManifest(TCG.manifest, "cardboard-castle.example")
    expect(m.merchant.name).toBe("Cardboard Castle")
    expect(m.endpoints.order).toBe("https://cardboard-castle.example/anvard/orders/{id}")
    const rel = parseManifest(
      { ...TCG.manifest, endpoints: { products: "/p", checkout: "/c", order: "/o/{id}" } },
      "shop.example",
    )
    expect(rel.endpoints.products).toBe("https://shop.example/p")
    expect(() => parseManifest({ anvard: "9" }, "x")).toThrow(ProtocolError)
    expect(() =>
      parseManifest(
        { ...TCG.manifest, endpoints: { ...TCG.manifest.endpoints, checkout: "http://insecure" } },
        "x",
      ),
    ).toThrow(/https/)
  })
  it("feed: cents or sats (converted), tcg fields kept, bad rows dropped, merchant must match", () => {
    const ps = parseFeed(TCG.feed, "cardboard-castle", toCents)
    expect(ps.map((p) => p.id)).toEqual([
      "charizard-base-4-102-lp",
      "black-lotus-proxy",
      "booster-box-obf",
    ])
    expect(ps[0]).toMatchObject({
      category: "tcg",
      priceCents: 42_000n,
      tcg: {
        game: "pokemon",
        set: "Base Set",
        number: "4/102",
        condition: "LP",
        provenanceUrl: "https://tcg-provenance.vercel.app/r/abc123",
      },
    })
    expect(ps[1]?.priceCents).toBe(toCents(900_000n))
    expect(ps[2]?.dealCents).toBe(10_999n)
    expect(() => parseFeed(TCG.feed, "other-shop", toCents)).toThrow(/match/)
  })
  it("checkout and order status responses are validated; remote ids round-trip", () => {
    const c = parseCheckoutResponse({
      anvard: "0.1",
      orderId: "o1",
      bolt11: "lnbc1abc",
      paymentHash: "A".repeat(64),
      amountSats: 1000,
      expiresAt: "2026-10-21T00:10:00Z",
      fulfilment: "instant",
    })
    expect(c.paymentHash).toBe("a".repeat(64))
    expect(() =>
      parseCheckoutResponse({
        anvard: "0.1",
        orderId: "o1",
        bolt11: "nope",
        paymentHash: "a",
        amountSats: 0,
        expiresAt: "",
      }),
    ).toThrow(ProtocolError)
    expect(
      parseOrderStatus({ anvard: "0.1", orderId: "o1", state: "paid", paymentHash: "a".repeat(64) })
        .state,
    ).toBe("paid")
    expect(() =>
      parseOrderStatus({ anvard: "0.1", orderId: "o1", state: "weird", paymentHash: "" }),
    ).toThrow(/state/)
    expect(
      parseRemoteProductId(remoteProductId("cardboard-castle", "charizard-base-4-102-lp")),
    ).toEqual({ merchantSlug: "cardboard-castle", id: "charizard-base-4-102-lp" })
    expect(parseRemoteProductId("dir:x:y")).toBeNull()
  })
})

describe("importers", () => {
  it("CSV: RFC 4180 quoting, TCGplayer-style columns → tcg products, stock from quantity, bad rows reported", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ])
    const r = importProductsCsv(TCG.csv, "cardboard-castle")
    expect(r.products.map((p) => p.id)).toEqual(["42", "43", "44"])
    expect(r.products[0]).toMatchObject({
      title: "Charizard, Holo",
      priceCents: 42_000n,
      inStock: true,
      category: "tcg",
      imageUrl: "https://img.example/charizard.jpg",
      tcg: { game: "pokemon", set: "Base Set", number: "4/102", condition: "Lightly Played" },
    })
    expect(r.products[0]?.description).toBe("Rarity: Holo Rare")
    expect(r.products[1]?.inStock).toBe(false)
    expect(r.products[2]).toMatchObject({
      priceCents: 250_000n,
      tcg: { game: "magic", set: "Alpha" },
    })
    expect(r.skipped).toEqual([{ row: 5, reason: "no title" }])
    const generic = importProductsCsv("title,price,qty\nMug,12.50,3\nBad,free,1\n", "hearth", {
      category: "home",
    })
    expect(generic.products[0]).toMatchObject({
      id: "mug",
      priceCents: 12_50n,
      category: "home",
      tcg: undefined,
    })
    expect(generic.skipped[0]?.reason).toContain("bad price")
    expect(importProductsCsv("foo,bar\n1,2", "x").skipped[0]?.reason).toContain("title column")
  })
  it("Shopify products.json: one product per variant, compare-at price becomes the list price, tags give the game and set", () => {
    const r = importShopifyProducts(
      {
        products: [
          {
            title: "Lightning Bolt",
            handle: "lightning-bolt",
            body_html: "<p>Alpha, <b>played</b></p>",
            tags: ["Magic", "set:Alpha"],
            images: [{ src: "https://cdn.shopify.com/x.jpg" }],
            variants: [{ sku: "LB-A", title: "Default Title", price: "25.00", available: true }],
          },
          {
            title: "Playmat",
            handle: "playmat",
            tags: "",
            images: [],
            variants: [
              { title: "Blue", price: "19.00", compare_at_price: "24.00", available: false },
              { title: "Red", price: "19.00", available: true },
            ],
          },
          { title: "", variants: [] },
        ],
      },
      "cardboard-castle",
    )
    expect(r.products.map((p) => p.id)).toEqual(["lb-a", "playmat-blue", "playmat-red"])
    expect(r.products[0]).toMatchObject({
      category: "tcg",
      priceCents: 25_00n,
      description: "Alpha, played",
      tcg: { game: "mtg", set: "Alpha" },
    })
    expect(r.products[1]).toMatchObject({
      title: "Playmat — Blue",
      priceCents: 24_00n,
      dealCents: 19_00n,
      inStock: false,
      category: "other",
    })
    expect(r.skipped).toEqual([{ row: 2, reason: "no title" }])
  })
})
