import {
  InMemoryPendingStore,
  type LlmClient,
  type LlmResponse,
  type UserContext,
} from "@agentic-bitcoin/agent"
import {
  FakeExchangeRail,
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  readEntries,
  replaceSetting,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { makeSweep, runReplacementsFor } from "@agentic-bitcoin/scheduler"
import { describe, expect, it } from "vitest"
import { Dispatcher, applyReplaceArgs, describePolicy } from "./dispatcher"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

const now = new Date("2026-10-27T12:00:00.000Z")

describe("applyReplaceArgs", () => {
  const p: Policy = { ...POLICIES.open, rails: { ...POLICIES.open.rails, exchange: false } }
  it("turns the rule on from now, switches the exchange rail on, and needs a key", () => {
    expect(applyReplaceArgs(p, ["on"], now, false)).toMatchObject({
      ok: false,
      error: expect.stringContaining("/key strike"),
    })
    const r = applyReplaceArgs(p, ["on", "50%"], now, true)
    expect(r).toMatchObject({
      ok: true,
      policy: {
        rails: { exchange: true },
        replaceSpend: { enabled: true, percent: 50, since: now.toISOString(), toWallet: true },
      },
    })
    if (!r.ok) return
    expect(r.text).toContain("The exchange rail is now on")
    expect(describePolicy(r.policy)).toContain("Replace what you spend: 50% of every spend")
    expect(applyReplaceArgs(p, ["on", "0"], now, true)).toMatchObject({ ok: false })
    expect(applyReplaceArgs(p, ["on", "150"], now, true)).toMatchObject({ ok: false })
  })
  it("shows, caps, mins, wallet toggle and off", () => {
    const on = applyReplaceArgs(p, ["on"], now, true)
    if (!on.ok) throw new Error("expected ok")
    expect(applyReplaceArgs(on.policy, [], now, true)).toMatchObject({
      ok: true,
      text: expect.stringContaining("Replace is ON"),
    })
    expect(applyReplaceArgs(on.policy, ["cap", "$20"], now, true)).toMatchObject({
      ok: true,
      policy: { replaceSpend: { dailyCapUsdCents: 2000n } },
    })
    expect(applyReplaceArgs(on.policy, ["cap", "0.5"], now, true)).toMatchObject({ ok: false })
    expect(applyReplaceArgs(on.policy, ["min", "2.50"], now, true)).toMatchObject({
      ok: true,
      policy: { replaceSpend: { minUsdCents: 250n } },
    })
    expect(applyReplaceArgs(on.policy, ["wallet", "off"], now, true)).toMatchObject({
      ok: true,
      policy: { replaceSpend: { toWallet: false } },
    })
    expect(applyReplaceArgs(on.policy, ["off"], now, true)).toMatchObject({
      ok: true,
      policy: { replaceSpend: { enabled: false } },
    })
    expect(applyReplaceArgs(p, ["off"], now, true)).toMatchObject({
      ok: true,
      text: "Replace is already off.",
    })
    expect(applyReplaceArgs(p, ["bogus"], now, true)).toMatchObject({ ok: false })
  })
})

/** A scripted model: one pay_lightning_address tool call, then a summary. */
function payingLlm(amount: number): LlmClient {
  let call = 0
  return {
    async complete(): Promise<LlmResponse> {
      call++
      if (call === 1)
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
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Sent.", citations: null }],
      }
    },
  }
}

describe("replace after a spend in chat", () => {
  it("a paid address is bought back on the exchange, swept to the wallet, and the user is told", async () => {
    const surface = new FakeSurface()
    const policies = new InMemoryPolicyStore()
    const policy: Policy = {
      ...POLICIES.open,
      confirmAboveSats: 1_000_000n,
      replaceSpend: replaceSetting({ enabled: true, since: "2026-01-01T00:00:00.000Z" }, now),
    }
    void policies.set("u", policy)
    const ledger = new InMemoryLedgerStore()
    const exchange = new FakeExchangeRail({
      balanceCents: 100_00n,
      usdCentsPerBtc: PRICE.usdCentsPerBtc,
    })
    const wallet = new FakeWalletRail({ balanceSats: 100_000n })
    const paid: string[] = []
    const resolveContext = async (userId: string): Promise<UserContext> => ({
      userId,
      policy: (await policies.get(userId)) ?? policy,
      ledger,
      rails: { wallet, exchange },
      pending: new InMemoryPendingStore(),
    })
    const sent: string[] = []
    const d = new Dispatcher({
      surface,
      agent: { llm: payingLlm(20_000), price: async () => PRICE, now: clockAt() },
      resolveContext,
      policies,
      history: new InMemoryHistoryStore(),
      secrets: new InMemorySecretStore(),
      secretsKey: null,
      probeWallet: async () => ({}),
      now: clockAt(),
      afterSpend: async (userId) => {
        const r = await runReplacementsFor(userId, {
          resolve: async (u) => {
            const c = await resolveContext(u)
            return { policy: c.policy, ledger: c.ledger, rails: c.rails }
          },
          price: async () => PRICE,
          now: () => now,
          sweep: makeSweep(() => ({
            async payLightningInvoice(bolt11: string) {
              paid.push(bolt11)
              return { paymentId: "p1" }
            },
          })),
        })
        for (const x of r.done) sent.push(`${x.status}:${x.usdCents ?? ""}:${x.swept ?? ""}`)
      },
    })
    await d.start()
    await surface.receive({ userId: "u", text: "pay gm 20000 sats" })
    expect(surface.sent.at(-1)?.m.text).toBe("Sent.")
    expect(sent).toEqual(["succeeded:1663:true"])
    expect(paid).toHaveLength(1)
    const kinds = (await readEntries(ledger)).map((e) => `${e.action.kind}:${e.outcome}`)
    expect(kinds).toEqual(["pay_address:succeeded", "buy_bitcoin:succeeded"])
    // a second turn with no new spend replaces nothing
    await surface.receive({ userId: "u", text: "/replace" })
    expect(surface.sent.at(-1)?.m.text).toContain("Replace is ON")
    expect(sent).toHaveLength(1)
  })
})
