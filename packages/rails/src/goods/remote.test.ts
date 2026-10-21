import { type MerchantManifest, parseManifest } from "@agentic-bitcoin/core"
import { PRICE, TCG } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { RemoteMerchantRail, fetchManifest } from "./remote"

const manifest: MerchantManifest = parseManifest(TCG.manifest, "cardboard-castle.example")
const calls: { url: string; body?: unknown }[] = []
const fetchImpl = async (url: string, init?: RequestInit) => {
  calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
  const u = new URL(url)
  if (u.pathname === "/.well-known/anvard.json")
    return { ok: true, status: 200, json: async () => TCG.manifest }
  if (u.pathname === "/anvard/products")
    return { ok: true, status: 200, json: async () => TCG.feed }
  if (u.pathname === "/anvard/checkout")
    return {
      ok: true,
      status: 200,
      json: async () => ({
        anvard: "0.1",
        orderId: "cc-77",
        bolt11: "lnbc1remote",
        paymentHash: "b".repeat(64),
        amountSats: 505_000,
        expiresAt: "2026-10-21T00:10:00Z",
        fulfilment: "shipped",
      }),
    }
  if (u.pathname === "/anvard/orders/cc-77")
    return {
      ok: true,
      status: 200,
      json: async () => ({
        anvard: "0.1",
        orderId: "cc-77",
        state: "paid",
        paymentHash: "b".repeat(64),
      }),
    }
  return { ok: false, status: 404, json: async () => ({}) }
}

describe("RemoteMerchantRail", () => {
  it("fetches and caches the feed, searches with tcg fields, and surfaces rm: ids with store links", async () => {
    const rail = new RemoteMerchantRail({
      manifest,
      price: async () => PRICE,
      fetchImpl,
      now: () => new Date(0),
      siteUrl: "https://anvard.ai",
    })
    const r = await rail.searchProducts("charizard base set")
    expect(r).toEqual([
      expect.objectContaining({
        id: "rm:cardboard-castle:charizard-base-4-102-lp",
        name: "Charizard (Base Set) 4/102 — Cardboard Castle",
        usdCents: 42_000n,
        merchant: "cardboard-castle",
        kind: "physical",
        url: "https://anvard.ai/shop/p/cardboard-castle/charizard-base-4-102-lp",
      }),
    ])
    await rail.searchProducts("booster")
    expect(calls.filter((c) => c.url.endsWith("/anvard/products"))).toHaveLength(1)
    expect(await fetchManifest("cardboard-castle.example", fetchImpl)).toMatchObject({
      merchant: { slug: "cardboard-castle" },
    })
  })
  it("checkout posts to the shop and returns THEIR invoice; status reads from them; physical chat buys are refused for now", async () => {
    const rail = new RemoteMerchantRail({
      manifest,
      price: async () => PRICE,
      fetchImpl,
      buyerRef: "ref1",
    })
    const o = await rail.createRemoteOrder({
      items: [{ productId: "charizard-base-4-102-lp", qty: 1 }],
      shipping: { name: "G", address: "1 Main", city: "Denver", country: "US" },
    })
    expect(o).toMatchObject({
      orderId: "cardboard-castle/cc-77",
      bolt11: "lnbc1remote",
      amountSats: 505_000n,
      state: "unpaid",
      fulfilment: "shipped",
    })
    const sent = calls.find((c) => c.url.endsWith("/anvard/checkout"))?.body as {
      shipping?: { city: string }
      buyerRef?: string
      anvard: string
    }
    expect(sent).toMatchObject({ anvard: "0.1", buyerRef: "ref1", shipping: { city: "Denver" } })
    expect((await rail.getOrder("cardboard-castle/cc-77")).state).toBe("paid")
    await expect(
      rail.createOrder({
        productId: "rm:cardboard-castle:charizard-base-4-102-lp",
        usdCents: 42_000n,
        shippingSealed: "s",
      }),
    ).rejects.toMatchObject({ code: "REJECTED" })
    await expect(
      rail.createOrder({ productId: "rm:cardboard-castle:charizard-base-4-102-lp", usdCents: 1n }),
    ).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" })
    await expect(rail.createOrder({ productId: "rm:other:x", usdCents: 1n })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    )
  })
})
