import { createHash } from "node:crypto"
import { InMemoryPendingStore, type LlmClient, type UserContext } from "@agentic-bitcoin/agent"
import {
  FakeWalletRail,
  InMemoryCardStore,
  InMemoryLedgerStore,
  buildCard,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { Dispatcher } from "./dispatcher"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

const silent: LlmClient = {
  async complete() {
    return { stop_reason: "end_turn", content: [{ type: "text", text: "ok", citations: null }] }
  },
}

function setup() {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  void policies.set("u", { ...POLICIES.open, confirmAboveSats: 1_000n })
  const ledger = new InMemoryLedgerStore()
  const cards = new InMemoryCardStore()
  const resolveContext = async (userId: string): Promise<UserContext> => ({
    userId,
    policy: (await policies.get(userId)) ?? POLICIES.open,
    ledger,
    rails: { wallet: new FakeWalletRail({ balanceSats: 100_000n }) },
    pending: new InMemoryPendingStore(),
    cards: { store: cards },
  })
  const d = new Dispatcher({
    surface,
    agent: { llm: silent, price: async () => PRICE, now: clockAt() },
    resolveContext,
    policies,
    history: new InMemoryHistoryStore(),
    secrets: new InMemorySecretStore(),
    secretsKey: null,
    probeWallet: async () => ({}),
    now: clockAt(),
    cards,
    siteUrl: "https://anvard.example",
  })
  return { surface, d, cards }
}

describe("/cards claim", () => {
  it("attaches a web-made card to the chat user with its token, then lists it", async () => {
    const { surface, d, cards } = setup()
    const hash = createHash("sha256").update("tok").digest("hex")
    const web = buildCard(
      { name: "Steam purchases", scope: ["product:steam"], monthlyCapSats: 50_000n, resetDay: 1 },
      "web:abc",
      [],
      new Date("2026-10-27T00:00:00Z"),
      hash,
    )
    await cards.create(web)
    await d.start()
    await surface.receive({ userId: "u", text: `/cards claim ${web.id}` })
    expect(surface.sent.at(-1)?.m.text).toMatch(/^Usage: \/cards claim/)
    await surface.receive({ userId: "u", text: `/cards claim ${web.id} wrong` })
    expect(surface.sent.at(-1)?.m.text).toBe("That token does not match this card.")
    await surface.receive({ userId: "u", text: `/cards claim ${web.id} tok` })
    expect(surface.sent.at(-1)?.m.text).toContain(
      "Card “Steam purchases” is yours: 50,000 sats a month",
    )
    expect(surface.sent.at(-1)?.m.text).toContain(`https://anvard.example/card/${web.id}`)
    await surface.receive({ userId: "v", text: `/cards claim ${web.id} tok` })
    expect(surface.sent.at(-1)?.m.text).toBe("That card already belongs to someone.")
    await surface.receive({ userId: "u", text: "/cards" })
    expect(surface.sent.at(-1)?.m.text).toContain("Steam purchases")
    expect((await cards.listForUser("u")).map((c) => c.userId)).toEqual(["u"])
  })
})
