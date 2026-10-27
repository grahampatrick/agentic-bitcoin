import { describe, expect, it } from "vitest"
import type { Action } from "./action"
import {
  CardError,
  InMemoryCardStore,
  type VirtualCard,
  buildCard,
  cardFor,
  cardSpentSince,
  claimCard,
  isUnclaimed,
  normalizeScope,
  periodEnd,
  periodStart,
  scopeMatches,
} from "./cards"
import { execute } from "./executor"
import { FakeWalletRail } from "./fakes"
import { InMemoryLedgerStore, readEntries } from "./ledger"
import type { Policy } from "./policy"

const now = () => new Date("2026-10-22T15:00:00.000Z")
const policy: Policy = {
  dailyCapSats: 1_000_000n,
  perActionCapSats: 500_000n,
  confirmAboveSats: 100_000n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: true, goods: true, compute: true, onchain: true },
}
const steam: VirtualCard = {
  id: "card_steam",
  userId: "u1",
  name: "Steam purchases",
  scope: ["product:steam", "merchant:bitrefill"],
  monthlyCapSats: 50_000n,
  perActionCapSats: 30_000n,
  confirmAboveSats: 10_000n,
  resetDay: 1,
  state: "active",
  createdAt: "2026-10-01T00:00:00.000Z",
}
const coffee: VirtualCard = {
  id: "card_coffee",
  userId: "u1",
  name: "Coffee",
  scope: ["*@coffee.example"],
  monthlyCapSats: 5_000n,
  resetDay: 15,
  state: "active",
  createdAt: "2026-10-02T00:00:00.000Z",
}
const pay = (address: string, amountSats: bigint, key = address): Action => ({
  kind: "pay_address",
  idempotencyKey: key,
  requestedBy: "agent",
  address,
  amountSats,
})

describe("card scope and periods", () => {
  it("matches products, merchants, shops, rails, kinds, addresses and the wildcard; never reads", () => {
    const buy: Action = {
      kind: "buy_product",
      idempotencyKey: "k",
      requestedBy: "agent",
      merchant: "bitrefill",
      productId: "steam-us",
      description: "Steam gift card $25",
      usdCents: 2500n,
      amountSats: 30_000n,
    }
    expect(scopeMatches("product:steam", buy)).toBe(true)
    expect(scopeMatches("merchant:bitrefill", buy)).toBe(true)
    expect(scopeMatches("merchant:directory", buy)).toBe(false)
    expect(
      scopeMatches("shop:cardboard-castle", {
        ...buy,
        merchant: "directory",
        productId: "dir:cardboard-castle:x",
      }),
    ).toBe(true)
    expect(scopeMatches("rail:goods", buy)).toBe(true)
    expect(scopeMatches("kind:buy_product", buy)).toBe(true)
    expect(scopeMatches("*", buy)).toBe(true)
    expect(scopeMatches("*@coffee.example", pay("bob@coffee.example", 1n))).toBe(true)
    expect(
      scopeMatches("*", { kind: "get_balance", idempotencyKey: "", requestedBy: "agent" }),
    ).toBe(false)
    expect(cardFor(pay("bob@coffee.example", 1n), [steam, coffee])?.id).toBe("card_coffee")
    expect(cardFor(pay("bob@other.example", 1n), [steam, coffee])).toBeNull()
    expect(cardFor(buy, [{ ...steam, state: "closed" }])).toBeNull()
  })
  it("normalizes scopes and rejects empty or nonsense ones", () => {
    expect(normalizeScope([" Product:Steam ", "merchant:bitrefill", "product:steam"])).toEqual([
      "product:steam",
      "merchant:bitrefill",
    ])
    expect(() => normalizeScope([])).toThrow(/scope/)
    expect(() => normalizeScope(["rail:plastic"])).toThrow(/rail/)
  })
  it("period starts on the reset day in UTC and ends a month later", () => {
    expect(periodStart({ resetDay: 1 }, now())).toBe("2026-10-01T00:00:00.000Z")
    expect(periodStart({ resetDay: 25 }, now())).toBe("2026-09-25T00:00:00.000Z")
    expect(periodEnd({ resetDay: 25 }, now())).toBe("2026-10-25T00:00:00.000Z")
    expect(periodStart({ resetDay: 31 }, now())).toBe("2026-09-28T00:00:00.000Z") // clamped to the 28th; the 22nd is before it, so the period began last month
  })
})

function world(cards: VirtualCard[]) {
  const ledger = new InMemoryLedgerStore()
  const store = new InMemoryCardStore(cards)
  const wallet = new FakeWalletRail({ now })
  const run = (action: Action, confirmation?: { actionHash: string }) =>
    execute({
      action,
      policy,
      ledger,
      rails: { wallet },
      userId: "u1",
      cards: {
        store,
        siteUrl: "https://anvard.example",
        newViewToken: () => ({ token: "tok", hash: "h" }),
      },
      now,
      confirmation: confirmation
        ? { ...confirmation, confirmedBy: "u1", at: now().toISOString() }
        : undefined,
    })
  return { ledger, store, run }
}

describe("cards in the executor", () => {
  it("tags a matching spend with the card, budgets it, and the card's confirm threshold applies", async () => {
    const w = world([coffee])
    const r1 = await w.run(pay("bob@coffee.example", 2_000n, "a"))
    expect(r1.status).toBe("succeeded")
    expect(r1.decision.summary).toContain("card “Coffee”")
    const entries = await readEntries(w.ledger)
    expect(entries[0]?.action.cardId).toBe("card_coffee")
    expect(cardSpentSince(entries, "card_coffee", "2026-10-15T00:00:00.000Z")).toBe(2_000n)
    expect((await w.store.get("card_coffee"))?.spentSats).toBe(2_000n)
    // 2,000 spent; 3,001 more breaks the 5,000 monthly cap even though the user's policy allows it
    const r2 = await w.run(pay("bob@coffee.example", 3_001n, "b"))
    expect(r2).toMatchObject({ status: "denied", decision: { reason: "CARD_MONTHLY_CAP" } })
    // a non-matching spend is untouched by the card
    const r3 = await w.run(pay("alice@other.example", 3_001n, "c"))
    expect(r3.status).toBe("succeeded")
    expect((await readEntries(w.ledger)).at(-1)?.action.cardId).toBeUndefined()
  })
  it("a paused card denies, per-action cap on the card bites below the user's, and its lower confirm threshold asks", async () => {
    const buy = (amountSats: bigint, key: string): Action =>
      pay("shop@steam.example", amountSats, key)
    const w = world([{ ...steam, scope: ["*@steam.example"] }])
    const r1 = await w.run(buy(31_000n, "a"))
    expect(r1).toMatchObject({ status: "denied", decision: { reason: "CARD_PER_ACTION_CAP" } })
    const r2 = await w.run(buy(12_000n, "b"))
    expect(r2.status).toBe("awaiting_confirmation") // 12,000 ≥ card's 10,000 even though the user's threshold is 100,000
    const r3 = await w.run(buy(12_000n, "b"), {
      actionHash: (r2 as { decision: { actionHash: string } }).decision.actionHash,
    })
    expect(r3.status).toBe("succeeded")
    await w.store.update({ ...steam, scope: ["*@steam.example"], state: "paused" })
    const r4 = await w.run(buy(1_000n, "c"))
    expect(r4).toMatchObject({ status: "denied", decision: { reason: "CARD_PAUSED" } })
  })
  it("create_card asks for a yes, then exists with a view link; pause is instant; list shows spend", async () => {
    const w = world([])
    const create: Action = {
      kind: "create_card",
      idempotencyKey: "c1",
      requestedBy: "agent",
      name: "Steam purchases",
      scope: ["product:steam", "merchant:bitrefill"],
      monthlyCapSats: 50_000n,
      resetDay: 1,
    }
    const r1 = await w.run(create)
    expect(r1.status).toBe("awaiting_confirmation")
    expect(r1.decision.summary).toContain("Steam purchases")
    const r2 = await w.run(create, {
      actionHash: (r1 as { decision: { actionHash: string } }).decision.actionHash,
    })
    expect(r2.status).toBe("succeeded")
    const res = (r2 as { result: { card: { id: string; state: string }; link: string } }).result
    expect(res.card.state).toBe("active")
    expect(res.link).toBe(`https://anvard.example/card/${res.card.id}?t=tok`)
    const dup = await w.run({ ...create, idempotencyKey: "c2" }, undefined)
    expect(dup.status).toBe("awaiting_confirmation")
    const r3 = await w.run({
      kind: "update_card",
      idempotencyKey: "p",
      requestedBy: "agent",
      cardId: res.card.id,
      op: "pause",
    })
    expect(r3.status).toBe("succeeded")
    expect((await w.store.get(res.card.id))?.state).toBe("paused")
    const r4 = await w.run({
      kind: "update_card",
      idempotencyKey: "r",
      requestedBy: "agent",
      cardId: res.card.id,
      op: "resume",
    })
    expect(r4.status).toBe("awaiting_confirmation") // widening needs a yes
    const r5 = await w.run({ kind: "list_cards", idempotencyKey: "", requestedBy: "agent" })
    expect(r5.status).toBe("succeeded")
    expect(
      (r5 as { result: { cards: { name: string; remainingSats: bigint }[] } }).result.cards,
    ).toMatchObject([{ name: "Steam purchases", remainingSats: 50_000n }])
    const r6 = await w.run({
      kind: "update_card",
      idempotencyKey: "x",
      requestedBy: "agent",
      cardId: "card_nope",
      op: "pause",
    })
    expect(r6.status).toBe("failed")
  })
})

describe("cards made on the web, then claimed in chat", () => {
  const input = {
    name: "Steam purchases",
    scope: ["product:steam"],
    monthlyCapSats: 50_000n,
    resetDay: 1,
  }
  it("buildCard validates once for every caller", () => {
    const c = buildCard(input, "web:abc", [], now(), "h")
    expect(c).toMatchObject({
      userId: "web:abc",
      state: "active",
      viewTokenHash: "h",
      spentSats: 0n,
    })
    expect(isUnclaimed(c)).toBe(true)
    expect(() => buildCard({ ...input, name: " " }, "u", [], now())).toThrow(CardError)
    expect(() => buildCard({ ...input, monthlyCapSats: 0n }, "u", [], now())).toThrow(
      /at least 1 sat/,
    )
    expect(() => buildCard({ ...input, perActionCapSats: 0n }, "u", [], now())).toThrow(
      /per-payment/,
    )
    expect(() => buildCard({ ...input, scope: [] }, "u", [], now())).toThrow(/scope/)
    expect(() => buildCard(input, "u", [{ ...c, userId: "u" }], now())).toThrow(
      /already have a card called/,
    )
    expect(buildCard({ ...input, resetDay: 31 }, "u", [], now()).resetDay).toBe(28)
  })
  it("claim moves the card under the chat user only with the view token, once", async () => {
    const store = new InMemoryCardStore([buildCard(input, "web:abc", [], now(), "hash")])
    const id = (await store.listForUser("web:abc"))[0]?.id ?? ""
    expect(await claimCard(store, "card_nope", "hash", "u")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    })
    expect(await claimCard(store, id, "wrong", "u")).toEqual({ ok: false, code: "NOT_AUTHORIZED" })
    const r = await claimCard(store, id, "hash", "u")
    expect(r.ok && r.card.userId).toBe("u")
    expect(await store.listForUser("u")).toHaveLength(1)
    expect(await store.listForUser("web:abc")).toHaveLength(0)
    // claiming again from the same user is a no-op success; another user is refused
    expect((await claimCard(store, id, "hash", "u")).ok).toBe(true)
    expect(await claimCard(store, id, "hash", "v")).toEqual({ ok: false, code: "ALREADY_CLAIMED" })
    // a second web card with a name the user already has is refused at claim time
    const dup = buildCard(input, "web:zzz", [], new Date("2026-10-23T00:00:00Z"), "h2")
    await store.create(dup)
    expect(await claimCard(store, dup.id, "h2", "u")).toEqual({ ok: false, code: "NAME" })
  })
})
