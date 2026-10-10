import {
  InMemoryPendingStore,
  type LlmClient,
  type LlmResponse,
  type UserContext,
} from "@agentic-bitcoin/agent"
import {
  FakeWalletRail,
  InMemoryLedgerStore,
  InMemoryRecipientStore,
  recipientsForUser,
} from "@agentic-bitcoin/core"
import { PRICE, RECIPIENTS, clockAt } from "@agentic-bitcoin/fixtures"
import { parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { Dispatcher } from "./dispatcher"
import { parseSeed } from "./store/recipients"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const idleLlm: LlmClient = {
  async complete(): Promise<LlmResponse> {
    return { stop_reason: "end_turn", content: [{ type: "text", text: "ok", citations: null }] }
  },
}

function setup(probeOk = true) {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  const recipients = new InMemoryRecipientStore(Object.values(RECIPIENTS))
  const ledger = new InMemoryLedgerStore()
  const policy = {
    dailyCapSats: 100_000n,
    perActionCapSats: 50_000n,
    confirmAboveSats: 5_000n,
    allowDestinations: [],
    denyDestinations: [],
    coldStorageAddresses: [],
    killSwitch: false,
    rails: { wallet: true, exchange: false, goods: false, compute: false, onchain: false },
  }
  const d = new Dispatcher({
    surface,
    agent: { llm: idleLlm, price: async () => PRICE, now: clockAt() },
    resolveContext: async (userId): Promise<UserContext> => ({
      userId,
      policy,
      ledger,
      rails: { wallet: new FakeWalletRail() },
      pending: new InMemoryPendingStore(),
      recipients: recipientsForUser(recipients, userId),
    }),
    policies,
    history: new InMemoryHistoryStore(),
    secrets: new InMemorySecretStore(),
    secretsKey: KEY,
    probeWallet: async () => ({ methods: [] }),
    recipients,
    probeAddress: async () => (probeOk ? { ok: true } : { ok: false, error: "HTTP 404" }),
    now: clockAt("2026-10-11T12:00:00.000Z"),
  })
  const last = () => surface.sent.at(-1)?.m.text ?? ""
  return { surface, policies, recipients, ledger, d, last }
}
const withPolicy = async (s: ReturnType<typeof setup>, u: string) =>
  s.policies.set(u, {
    dailyCapSats: 1n,
    perActionCapSats: 1n,
    confirmAboveSats: 1n,
    allowDestinations: [],
    denyDestinations: [],
    coldStorageAddresses: [],
    killSwitch: false,
    rails: { wallet: true, exchange: false, goods: false, compute: false, onchain: false },
  })

describe("/recipients and /recipient", () => {
  it("lists verified directory entries plus the user's own, never another user's", async () => {
    const s = setup()
    await withPolicy(s, "u1")
    await withPolicy(s, "u2")
    await s.d.start()
    await s.surface.receive({ userId: "u1", text: "/recipients" })
    expect(s.last()).toContain("grace-fellowship")
    expect(s.last()).toContain("ortiz-family")
    expect(s.last()).toContain("my-pastor")
    expect(s.last()).not.toContain("new-church") // unverified, hidden
    await s.surface.receive({ userId: "u2", text: "/recipients" })
    expect(s.last()).not.toContain("my-pastor")
  })
  it("adds a private recipient after probing the address, and only its owner can remove it", async () => {
    const s = setup()
    await withPolicy(s, "u1")
    await withPolicy(s, "u2")
    await s.d.start()
    await s.surface.receive({
      userId: "u1",
      text: "/recipient add give@mychurch.example My Church Downtown",
    })
    expect(s.last()).toContain("my-church-downtown")
    const r = await s.recipients.get("my-church-downtown", "u1")
    expect(r).toMatchObject({
      ownerUserId: "u1",
      lightningAddress: "give@mychurch.example",
      verified: null,
    })
    await s.surface.receive({ userId: "u2", text: "/recipient remove my-church-downtown" })
    expect(s.last()).toContain("only remove recipients you added")
    await s.surface.receive({ userId: "u1", text: "/recipient remove my-church-downtown" })
    expect(s.last()).toContain("Removed")
    expect(await s.recipients.get("my-church-downtown", "u1")).toBeNull()
  })
  it("refuses bad addresses, dead addresses and directory slug collisions", async () => {
    const s = setup(false)
    await withPolicy(s, "u1")
    await s.d.start()
    await s.surface.receive({ userId: "u1", text: "/recipient add notanaddress Some Name" })
    expect(s.last()).toContain("not a Lightning address")
    await s.surface.receive({ userId: "u1", text: "/recipient add x@y.example Grace Fellowship" })
    expect(s.last()).toContain("already a directory recipient")
    await s.surface.receive({ userId: "u1", text: "/recipient add x@y.example Brand New" })
    expect(s.last()).toContain("does not answer")
  })
})

describe("/statement", () => {
  it("renders the year's gifts as CSV with a total, and says it is not a receipt", async () => {
    const s = setup()
    await withPolicy(s, "u1")
    await s.d.start()
    const give = {
      kind: "give" as const,
      idempotencyKey: "k",
      requestedBy: "user" as const,
      recipientSlug: "grace-fellowship",
      recipientName: "Grace Fellowship Church",
      address: "give@grace-fellowship.example",
      verified: true,
      amountSats: 1_000n,
      purpose: "tithe" as const,
      fiatCentsAtRequest: 83n,
    }
    await s.ledger.append({
      type: "requested",
      id: "a1",
      at: "2026-02-01T00:00:00.000Z",
      action: give,
      decision: { type: "allow", summary: "x" },
    })
    await s.ledger.append({
      type: "succeeded",
      id: "a1",
      at: "2026-02-01T00:00:01.000Z",
      preimage: "p",
    })
    await s.surface.receive({ userId: "u1", text: "/statement" })
    expect(s.last()).toContain("Giving statement 2026: 1 gift, 1,000 sats (≈ $0.83")
    expect(s.last()).toContain("not a receipt")
    expect(s.last()).toContain(
      "2026-02-01,Grace Fellowship Church,grace-fellowship,tithe,1000,0.83,p",
    )
    await s.surface.receive({ userId: "u1", text: "/statement 2025" })
    expect(s.last()).toBe("No gifts recorded in 2025.")
  })
})

describe("recipients seed file", () => {
  it("parses the example file and rejects bad entries", () => {
    const entries = parseSeed(
      JSON.stringify([
        {
          slug: "grace-fellowship",
          kind: "church",
          name: "Grace",
          lightningAddress: "Give@Grace.example",
          verified: true,
        },
      ]),
    )
    expect(entries[0]).toMatchObject({ lightningAddress: "give@grace.example", verified: true })
    expect(() =>
      parseSeed(
        JSON.stringify([{ slug: "Bad!", kind: "church", name: "x", lightningAddress: "a@b.c" }]),
      ),
    ).toThrow(/slug/)
    expect(() =>
      parseSeed(
        JSON.stringify([{ slug: "ok", kind: "bank", name: "x", lightningAddress: "a@b.c" }]),
      ),
    ).toThrow(/kind/)
    expect(() => parseSeed(JSON.stringify({}))).toThrow(/array/)
  })
})
