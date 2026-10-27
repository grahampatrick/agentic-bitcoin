import { InMemoryPendingStore, type LlmClient, type UserContext } from "@agentic-bitcoin/agent"
import {
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  readEntries,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { InMemoryScheduleStore, runDue, schedulesHook } from "@agentic-bitcoin/scheduler"
import { describe, expect, it } from "vitest"
import { Dispatcher } from "./dispatcher"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

const silent: LlmClient = {
  async complete() {
    return { stop_reason: "end_turn", content: [{ type: "text", text: "ok", citations: null }] }
  },
}

describe("/bills and an ask-mode bill answered with yes", () => {
  it("lists bills with the next date, parks a due ask-bill, pays on yes, and cancels", async () => {
    const surface = new FakeSurface()
    const policies = new InMemoryPolicyStore()
    const policy: Policy = { ...POLICIES.open, confirmAboveSats: 1_000n }
    void policies.set("u", policy)
    const ledger = new InMemoryLedgerStore()
    const wallet = new FakeWalletRail({ balanceSats: 100_000n })
    const pending = new InMemoryPendingStore()
    const store = new InMemoryScheduleStore()
    const resolveContext = async (userId: string): Promise<UserContext> => ({
      userId,
      policy,
      ledger,
      rails: { wallet },
      pending,
      schedules: schedulesHook(store, { userId }),
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
      now: () => new Date("2026-10-27T12:00:00Z"),
    })
    await d.start()
    await surface.receive({ userId: "u", text: "/bills" })
    expect(surface.sent.at(-1)?.m.text).toMatch(/^No bills yet/)
    const s = await store.create({
      userId: "u",
      kind: "bill",
      exchange: "strike",
      usdCents: 0n,
      address: "bills@carrier.example",
      bill: { name: "Phone plan", mode: "ask" },
      cron: "0 14 1 * *",
      estimatedSats: 5_000n,
      sweepToWallet: false,
    })
    await surface.receive({ userId: "u", text: "/bills" })
    expect(surface.sent.at(-1)?.m.text).toContain(
      `• Bill “Phone plan” 5,000 sats to bills@carrier.example (asks first) (${s.id}) · next 2026-11-01`,
    )
    // the 1st arrives: the runner asks through the same pending store the dispatcher confirms from
    await runDue({
      schedules: store,
      resolve: async () => ({ policy, ledger, rails: { wallet } }),
      price: async () => PRICE,
      now: () => new Date("2026-11-01T14:00:05Z"),
      ask: async (userId, action, summary) => {
        const { actionHash } = await import("@agentic-bitcoin/core")
        await pending.set(userId, actionHash(action), action)
        await surface.send(userId, { text: `${summary} is due. Reply yes to pay it.` })
        return summary
      },
    })
    expect(surface.sent.at(-1)?.m.text).toContain(
      "Bill “Phone plan”: 5,000 sats to bills@carrier.example is due",
    )
    await surface.receive({ userId: "u", text: "yes" })
    expect(surface.sent.at(-1)?.m.text).toMatch(/^Done\. Pay bills@carrier.example/)
    expect((await wallet.getBalance()).sats).toBe(100_000n - 5_000n - 6n)
    expect((await readEntries(ledger)).map((e) => e.outcome)).toEqual(["succeeded"])
    await surface.receive({ userId: "u", text: `/bills cancel ${s.id}` })
    expect(surface.sent.at(-1)?.m.text).toBe(`Stopped ${s.id}. Nothing already paid changes.`)
    expect((await store.listActive()).length).toBe(0)
  })
})
