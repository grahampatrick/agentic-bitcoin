import { InMemoryPendingStore, ScriptedLlmClient, type UserContext } from "@agentic-bitcoin/agent"
import {
  FakeWalletRail,
  InMemoryLedgerStore,
  InMemoryWebLinkStore,
  type Policy,
  hashWebToken,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { Dispatcher } from "./dispatcher"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

function setup(opts: { webLinks?: boolean; siteUrl?: string } = {}) {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  const policy: Policy = { ...POLICIES.open }
  void policies.set("u", policy)
  const pending = new InMemoryPendingStore()
  const store = new InMemoryWebLinkStore()
  let n = 0
  const resolveContext = async (userId: string): Promise<UserContext> => ({
    userId,
    policy,
    ledger: new InMemoryLedgerStore(),
    rails: { wallet: new FakeWalletRail({ balanceSats: 100_000n }) },
    pending,
  })
  const d = new Dispatcher({
    surface,
    agent: { llm: new ScriptedLlmClient(), price: async () => PRICE, now: clockAt() },
    resolveContext,
    policies,
    history: new InMemoryHistoryStore(),
    secrets: new InMemorySecretStore(),
    secretsKey: null,
    probeWallet: async () => ({}),
    siteUrl: opts.siteUrl ?? "https://anvard.ai",
    webLinks:
      opts.webLinks === false
        ? undefined
        : { store, newToken: () => `tok_${++n}`.padEnd(32, "x"), ttlDays: 30 },
    now: () => new Date("2026-10-29T12:00:00Z"),
  })
  const last = () => surface.sent.at(-1)?.m.text ?? ""
  const say = async (text: string) => {
    await surface.receive({ userId: "u", text })
    return last()
  }
  return { d, say, store }
}

describe("the workspace link (M23, ADR-0027)", () => {
  it("/web mints a 30-day link whose hash alone is stored; /web revoke cuts every link off", async () => {
    const { d, say, store } = setup()
    await d.start()
    const reply = await say("/web")
    expect(reply).toContain("https://anvard.ai/me?t=tok_1xxxxxxxxxxxxxxxxxxxxxxxxxxx")
    expect(reply).toContain("30 days")
    const now = new Date("2026-10-29T12:00:00Z")
    expect(await store.userFor(hashWebToken("tok_1xxxxxxxxxxxxxxxxxxxxxxxxxxx"), now)).toBe("u")
    expect((await store.listForUser("u"))[0]?.expiresAt).toBe("2026-11-28T12:00:00.000Z")
    await say("/account")
    expect((await store.listForUser("u")).length).toBe(2)
    expect(await say("/web revoke")).toMatch(/^Every web link for you is revoked/)
    expect((await store.listForUser("u")).length).toBe(0)
    expect(await say("/help")).toContain("/web — your workspace")
  })

  it("is off without a store or a site url", async () => {
    const off = setup({ webLinks: false })
    await off.d.start()
    expect(await off.say("/web")).toBe("The web workspace is not on for this server.")
  })
})
