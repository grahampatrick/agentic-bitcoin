import {
  FakeWalletRail,
  InMemoryCardStore,
  InMemoryLedgerStore,
  type Policy,
  readEntries,
} from "@agentic-bitcoin/core"
import { PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { InMemoryPendingStore, type UserContext, confirmPending, runTurn } from "./agent"
import { ScriptedLlmClient, intentOf } from "./scripted"

const policy: Policy = {
  dailyCapSats: 1_000_000n,
  perActionCapSats: 500_000n,
  confirmAboveSats: 1_000_000n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: false, goods: true, compute: false, onchain: false },
}
const now = () => new Date("2026-10-22T15:00:00.000Z")
function world() {
  const store = new InMemoryCardStore()
  const ledger = new InMemoryLedgerStore()
  const ctx: UserContext = {
    userId: "u1",
    policy,
    ledger,
    rails: { wallet: new FakeWalletRail({ now }) },
    pending: new InMemoryPendingStore(),
    cards: {
      store,
      siteUrl: "https://anvard.example",
      newViewToken: () => ({ token: "t0k", hash: "h" }),
    },
  }
  const deps = {
    llm: new ScriptedLlmClient(),
    resolveContext: async () => ctx,
    price: async () => PRICE,
    now,
  }
  return { ctx, deps, store, ledger }
}

describe("scripted card intents", () => {
  it("understands create, list and pause", () => {
    expect(intentOf("create a virtual card for steam with a 50,000 sat monthly limit")).toEqual({
      name: "create_card",
      input: {
        name: "Steam",
        scope: "product:steam, merchant:bitrefill",
        monthly_cap_sats: 50_000,
        per_action_cap_sats: 0,
        confirm_above_sats: 0,
        reset_day: 1,
      },
    })
    expect(
      intentOf("make a card for bob@coffee.example with 5000 sats a month")?.input,
    ).toMatchObject({ scope: "bob@coffee.example" })
    expect(intentOf("my cards")?.name).toBe("list_cards")
    expect(intentOf("what's left on my steam card")?.name).toBe("list_cards")
    expect(intentOf("pause card card_abc")).toEqual({
      name: "update_card",
      input: { card_id: "card_abc", op: "pause", monthly_cap_sats: 0 },
    })
  })
})

describe("cards through the agent", () => {
  it("create asks for a yes, then the card exists with a page link; a scoped payment is budgeted; pause is instant", async () => {
    const w = world()
    const t1 = await runTurn(
      w.deps,
      "u1",
      "create a virtual card for bob@coffee.example with 5000 sats a month",
      [],
    )
    expect(t1.pending).toBeTruthy()
    expect(t1.reply).toContain("Create virtual card “bob@coffee.example”")
    const r = await confirmPending(w.ctx, t1.pending?.actionHash ?? "", {
      confirmedBy: "u1",
      price: PRICE,
      now,
    })
    expect(r.status).toBe("succeeded")
    const cards = await w.store.listForUser("u1")
    expect(cards).toHaveLength(1)
    expect(cards[0]?.scope).toEqual(["bob@coffee.example"])
    const t2 = await runTurn(w.deps, "u1", "pay 2000 sats to bob@coffee.example", [])
    expect(t2.reply).toMatch(/^Paid/)
    expect((await readEntries(w.ledger)).at(-1)?.action.cardId).toBe(cards[0]?.id)
    const t3 = await runTurn(w.deps, "u1", "pay 4000 sats to bob@coffee.example", [])
    expect(t3.reply).toMatch(/card monthly cap|can't do that/i)
    const t4 = await runTurn(w.deps, "u1", "my cards", [])
    expect(t4.reply).toContain("2,000 / 5,000 sats")
    const t5 = await runTurn(w.deps, "u1", `pause card ${cards[0]?.id}`, [])
    expect(t5.reply).toContain("now paused")
    expect((await w.store.get(cards[0]?.id ?? ""))?.state).toBe("paused")
  })
})
