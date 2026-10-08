import {
  InMemoryPendingStore,
  type LlmClient,
  type LlmResponse,
  type UserContext,
} from "@agentic-bitcoin/agent"
import { FakeWalletRail, InMemoryLedgerStore, readEntries } from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { Dispatcher, applyBudgetArgs, describePolicy } from "./dispatcher"
import {
  InMemoryHistoryStore,
  InMemoryPolicyStore,
  InMemorySecretStore,
  trimHistory,
} from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

/** A scripted model: first call emits a tool_use for pay_lightning_address, second call summarises. */
function scriptedLlm(amount: number): LlmClient {
  let call = 0
  return {
    async complete(): Promise<LlmResponse> {
      call++
      if (call === 1) {
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu_1",
              name: "pay_lightning_address",
              input: { address: "gm@getalby.com", amount_sats: amount, memo: "" },
            },
          ],
        }
      }
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Relayed.", citations: null }],
      }
    },
  }
}

function setup(amount = 21) {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  const ledger = new InMemoryLedgerStore()
  const pending = new InMemoryPendingStore()
  const wallet = new FakeWalletRail({ balanceSats: 100_000n })
  const resolveContext = async (userId: string): Promise<UserContext> => ({
    userId,
    policy: (await policies.get(userId)) ?? { ...POLICIES.open, confirmAboveSats: 1_000n },
    ledger,
    rails: { wallet },
    pending,
  })
  const d = new Dispatcher({
    surface,
    agent: { llm: scriptedLlm(amount), price: async () => PRICE, now: clockAt() },
    resolveContext,
    policies,
    history: new InMemoryHistoryStore(),
    secrets: new InMemorySecretStore(),
    secretsKey: null,
    probeWallet: async () => ({}),
    now: clockAt(),
  })
  return { surface, d, ledger, wallet, policies }
}

describe("dispatcher", () => {
  it("runs a small payment through the model and replies", async () => {
    const { surface, d, wallet } = setup(21)
    await d.start()
    await surface.receive({ userId: "u", text: "tip gm 21 sats" })
    expect(surface.sent.at(-1)?.m.text).toBe("Relayed.")
    expect((await wallet.getBalance()).sats).toBe(100_000n - 22n)
  })
  it("parks a large payment with a confirm button, then a plain 'yes' releases it", async () => {
    const { surface, d, wallet, ledger } = setup(5_000)
    await d.start()
    await surface.receive({ userId: "u", text: "pay gm 5000 sats" })
    const last = surface.sent.at(-1)
    expect(last?.m.confirm?.actionHash).toMatch(/^[0-9a-f]{64}$/)
    expect((await wallet.getBalance()).sats).toBe(100_000n)
    await surface.receive({ userId: "u", text: "yes" })
    expect(surface.sent.at(-1)?.m.text).toMatch(/^Done\. Pay gm@getalby.com · 5,000 sats/)
    expect((await wallet.getBalance()).sats).toBe(100_000n - 5_000n - 6n)
    expect((await readEntries(ledger)).map((e) => e.outcome)).toEqual([
      "awaiting_confirmation",
      "succeeded",
    ])
    // a second yes finds nothing pending and falls through to the model, never re-pays
    await surface.receive({ userId: "u", text: "yes" })
    expect((await wallet.getBalance()).sats).toBe(100_000n - 5_006n)
  })
  it("a button decision with the wrong hash is refused; 'no' cancels", async () => {
    const { surface, d, wallet } = setup(5_000)
    await d.start()
    await surface.receive({ userId: "u", text: "pay gm 5000 sats" })
    await surface.receive({
      userId: "u",
      text: "yes",
      decision: { actionHash: "f".repeat(64), approve: true },
    })
    expect(surface.sent.at(-1)?.m.text).toContain("expired or was already used")
    await surface.receive({ userId: "u", text: "no" })
    expect(surface.sent.at(-1)?.m.text).toBe("Cancelled. Nothing was sent.")
    expect((await wallet.getBalance()).sats).toBe(100_000n)
  })
  it("/kill blocks everything until /resume; /budget edits policy without the model", async () => {
    const { surface, d, wallet, policies } = setup(21)
    await d.start()
    await surface.receive({ userId: "u", text: "/kill" })
    expect((await policies.get("u"))?.killSwitch).toBe(true)
    await surface.receive({ userId: "u", text: "tip gm 21 sats" })
    expect((await wallet.getBalance()).sats).toBe(100_000n)
    await surface.receive({ userId: "u", text: "/resume" })
    await surface.receive({ userId: "u", text: "/budget daily 123" })
    expect((await policies.get("u"))?.dailyCapSats).toBe(123n)
    expect(surface.sent.at(-1)?.m.text).toContain("Daily cap 123 sats")
    await surface.receive({ userId: "u", text: "/budget nonsense" })
    expect(surface.sent.at(-1)?.m.text).toContain("Usage")
  })
  it("/ledger shows the window spend in sats and fiat", async () => {
    const { surface, d } = setup(21)
    await d.start()
    await surface.receive({ userId: "u", text: "tip" })
    await surface.receive({ userId: "u", text: "/ledger" })
    const t = surface.sent.at(-1)?.m.text ?? ""
    expect(t).toContain("Last 24h: 21 sats (≈ $0.01)")
    expect(t).toContain("succeeded")
  })
})

describe("pure helpers", () => {
  it("applyBudgetArgs", () => {
    const p = POLICIES.open
    expect(applyBudgetArgs(p, ["daily", "50000"])).toMatchObject({
      ok: true,
      policy: { dailyCapSats: 50_000n },
    })
    expect(applyBudgetArgs(p, ["daily", "-1"])).toMatchObject({ ok: false })
    expect(applyBudgetArgs(p, ["allow", "GM@GetAlby.com"])).toMatchObject({
      ok: true,
      policy: { allowDestinations: ["gm@getalby.com"] },
    })
    expect(applyBudgetArgs(p, ["rail", "exchange", "off"])).toMatchObject({
      ok: true,
      policy: { rails: { exchange: false } },
    })
    expect(applyBudgetArgs(p, ["rail", "teleport", "on"])).toMatchObject({ ok: false })
  })
  it("describePolicy mentions the kill switch", () => {
    expect(describePolicy({ ...POLICIES.open, killSwitch: true })).toContain("KILL SWITCH ON")
  })
  it("trimHistory keeps whole turns", () => {
    const h = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: [] },
      { role: "user" as const, content: "b" },
      { role: "assistant" as const, content: [] },
      {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: "x", content: "r" }],
      },
      { role: "assistant" as const, content: [] },
    ]
    expect(trimHistory(h, 1)).toHaveLength(4)
    expect(trimHistory(h, 5)).toHaveLength(6)
  })
})
