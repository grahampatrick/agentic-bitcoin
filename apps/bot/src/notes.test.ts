import { InMemoryPendingStore, ScriptedLlmClient, type UserContext } from "@agentic-bitcoin/agent"
import {
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  readEntries,
  serializeAction,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { encryptSecret, generateKeyHex, parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { Dispatcher } from "./dispatcher"
import { InMemoryHistoryStore, InMemoryPolicyStore, InMemorySecretStore } from "./store/stores"
import { FakeSurface } from "./surfaces/surface"

function setup(secretsKey: Buffer | null) {
  const surface = new FakeSurface()
  const policies = new InMemoryPolicyStore()
  const policy: Policy = { ...POLICIES.open }
  void policies.set("u", policy)
  const ledger = new InMemoryLedgerStore()
  const wallet = new FakeWalletRail({ balanceSats: 100_000n })
  const pending = new InMemoryPendingStore()
  const resolveContext = async (userId: string): Promise<UserContext> => ({
    userId,
    policy,
    ledger,
    rails: { wallet },
    pending,
    seal: secretsKey ? (s) => encryptSecret(s, secretsKey) : undefined,
  })
  const d = new Dispatcher({
    surface,
    agent: { llm: new ScriptedLlmClient(), price: async () => PRICE, now: clockAt() },
    resolveContext,
    policies,
    history: new InMemoryHistoryStore(),
    secrets: new InMemorySecretStore(),
    secretsKey,
    probeWallet: async () => ({}),
    now: () => new Date("2026-10-27T12:00:00Z"),
  })
  const last = () => surface.sent.at(-1)?.m.text ?? ""
  const say = async (text: string) => {
    await surface.receive({ userId: "u", text })
    return last()
  }
  return { d, ledger, say }
}

describe("private transaction notes (M21, ADR-0024)", () => {
  it("notes a payment from chat, lists, replaces, shows in /ledger and clears; the payee never sees it", async () => {
    const { d, ledger, say } = setup(null)
    await d.start()
    expect(await say("/notes")).toMatch(/^No private notes yet/)
    const paid = await say("pay 500 sats to gm@getalby.com, note: plumber deposit")
    expect(paid).toContain("Noted privately")
    expect(paid).toContain("Paid.")
    let entries = await readEntries(ledger)
    const pay = entries.find((e) => e.action.kind === "pay_address")
    expect(pay?.note).toBe("plumber deposit")
    expect((pay?.action as { memo?: string }).memo).toBeUndefined()
    expect(serializeAction(pay?.action as Parameters<typeof serializeAction>[0])).not.toContain(
      "plumber",
    )
    expect(await say("/notes")).toContain("Pay gm@getalby.com · 500 sats")
    expect(await say("/notes")).toContain("“plumber deposit”")
    expect(await say("/note reimbursed by work")).toMatch(/^Noted privately on “Pay gm@getalby.com/)
    const ledgerText = await say("/ledger")
    expect(ledgerText).toContain("— “reimbursed by work”")
    expect(ledgerText).not.toContain("private note to")
    expect(ledgerText).not.toContain("plumber")
    expect(await say(`/note ${pay?.id} coffee money`)).toContain(`(${pay?.id})`)
    expect(await say("/notes")).toContain("“coffee money”")
    expect(await say("/note clear")).toMatch(/^Note removed from/)
    expect(await say("/notes")).toMatch(/^No private notes yet/)
    expect(await say("/note act_nope hello")).toBe("No payment act_nope in your ledger.")
    entries = await readEntries(ledger)
    expect(entries.filter((e) => e.action.kind === "add_note").every((e) => !e.note)).toBe(true)
  })
  it("seals notes at rest when the server has SECRETS_KEY and opens them for the user only", async () => {
    const key = parseKey(generateKeyHex())
    const { d, ledger, say } = setup(key)
    await d.start()
    await say("pay 500 sats to gm@getalby.com, note: rent share")
    const pay = (await readEntries(ledger)).find((e) => e.action.kind === "pay_address")
    expect(pay?.note).toBeUndefined()
    expect(pay?.noteSealed).toBeDefined()
    const raw = JSON.stringify(await ledger.events(), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    )
    expect(raw).not.toContain("rent share")
    expect(await say("/notes")).toContain("“rent share”")
    expect(await say("/ledger")).toContain("— “rent share”")
  })
  it("/note with nothing to note explains itself", async () => {
    const { d, say } = setup(null)
    await d.start()
    expect(await say("/note")).toMatch(/^Usage: \/note/)
    expect(await say("/note hello")).toMatch(/^No payment to note yet/)
  })
})
