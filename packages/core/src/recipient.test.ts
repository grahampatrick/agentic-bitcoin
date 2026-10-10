import { RECIPIENTS } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import type { Action } from "./action"
import { InMemoryLedgerStore, foldEntries } from "./ledger"
import { DEFAULT_POLICY, evaluate } from "./policy"
import {
  InMemoryRecipientStore,
  type Recipient,
  givingRows,
  givingStatementCsv,
  isLightningAddress,
  isTrustedRecipient,
  recipientsForUser,
  slugify,
} from "./recipient"

const all: Recipient[] = Object.values(RECIPIENTS)

describe("recipient store scoping", () => {
  const store = new InMemoryRecipientStore(all)
  it("hides private recipients from other users and shows them to their owner", async () => {
    expect(await store.get("my-pastor")).toBeNull()
    expect(await store.get("my-pastor", "u2")).toBeNull()
    expect((await store.get("my-pastor", "u1"))?.slug).toBe("my-pastor")
    const u1 = recipientsForUser(store, "u1")
    expect((await u1.list()).map((r) => r.slug)).toContain("my-pastor")
    const u2 = recipientsForUser(store, "u2")
    expect((await u2.list()).map((r) => r.slug)).not.toContain("my-pastor")
  })
  it("searches by words across name, kind, country and description", async () => {
    expect((await store.search("church denver")).map((r) => r.slug)).toEqual(["grace-fellowship"])
    expect((await store.search("missionary peru")).map((r) => r.slug)).toEqual(["ortiz-family"])
    expect((await store.search("the ortiz family")).map((r) => r.slug)).toEqual(["ortiz-family"])
    expect(await store.search("nothing-like-this")).toEqual([])
  })
  it("rejects bad slugs", async () => {
    await expect(store.upsert({ ...RECIPIENTS.church, slug: "Bad Slug!" })).rejects.toThrow(/slug/)
  })
})

describe("trust", () => {
  it("verified directory entries are trusted by everyone; private ones only by their owner", () => {
    expect(isTrustedRecipient(RECIPIENTS.church, "anyone")).toBe(true)
    expect(isTrustedRecipient(RECIPIENTS.unverified, "anyone")).toBe(false)
    expect(isTrustedRecipient(RECIPIENTS.mine, "u1")).toBe(true)
    expect(isTrustedRecipient(RECIPIENTS.mine, "u2")).toBe(false)
  })
  it("slugify and lightning address checks", () => {
    expect(slugify("Grace Fellowship Church!")).toBe("grace-fellowship-church")
    expect(slugify("  Église Saint-Jean ")).toBe("eglise-saint-jean")
    expect(isLightningAddress("give@grace-fellowship.example")).toBe(true)
    expect(isLightningAddress("not an address")).toBe(false)
  })
})

describe("give through the policy", () => {
  const give = (over: Partial<Extract<Action, { kind: "give" }>> = {}): Action => ({
    kind: "give",
    idempotencyKey: "k1",
    requestedBy: "user",
    recipientSlug: "grace-fellowship",
    recipientName: "Grace Fellowship Church",
    address: "give@grace-fellowship.example",
    verified: true,
    amountSats: 1_000n,
    purpose: "tithe",
    ...over,
  })
  it("allows a small verified gift and denies an unverified one before any cap", () => {
    expect(evaluate(give(), DEFAULT_POLICY, { spentSats: 0n }).type).toBe("allow")
    const d = evaluate(give({ verified: false }), DEFAULT_POLICY, { spentSats: 0n })
    expect(d).toMatchObject({ type: "deny", reason: "RECIPIENT_UNVERIFIED" })
  })
  it("applies deny lists to the recipient's address and confirms above the threshold", () => {
    const denied = evaluate(
      give(),
      { ...DEFAULT_POLICY, denyDestinations: ["*@grace-fellowship.example"] },
      { spentSats: 0n },
    )
    expect(denied).toMatchObject({ type: "deny", reason: "DESTINATION_DENIED" })
    expect(evaluate(give({ amountSats: 20_000n }), DEFAULT_POLICY, { spentSats: 0n }).type).toBe(
      "needs_confirmation",
    )
  })
  it("a recurring gift always needs a yes", () => {
    const a: Action = {
      kind: "schedule_give",
      idempotencyKey: "k2",
      requestedBy: "user",
      recipientSlug: "grace-fellowship",
      recipientName: "Grace Fellowship Church",
      address: "give@grace-fellowship.example",
      verified: true,
      amountSats: 100n,
      cron: "0 14 * * 0",
      purpose: "tithe",
    }
    expect(evaluate(a, DEFAULT_POLICY, { spentSats: 0n }).type).toBe("needs_confirmation")
  })
})

describe("giving statement", () => {
  it("lists succeeded gifts of the year, with fiat when known, as CSV", async () => {
    const ledger = new InMemoryLedgerStore()
    const base = {
      kind: "give" as const,
      requestedBy: "user" as const,
      recipientSlug: "grace-fellowship",
      recipientName: 'Grace "GF" Church',
      address: "give@grace-fellowship.example",
      verified: true,
      purpose: "tithe" as const,
    }
    const dec = { type: "allow" as const, summary: "s" }
    await ledger.append({
      type: "requested",
      id: "a1",
      at: "2026-03-01T10:00:00.000Z",
      action: { ...base, idempotencyKey: "a", amountSats: 1_000n, fiatCentsAtRequest: 83n },
      decision: dec,
    })
    await ledger.append({
      type: "succeeded",
      id: "a1",
      at: "2026-03-01T10:00:01.000Z",
      preimage: "ab",
    })
    await ledger.append({
      type: "requested",
      id: "a2",
      at: "2026-01-05T10:00:00.000Z",
      action: { ...base, idempotencyKey: "b", amountSats: 500n },
      decision: dec,
    })
    await ledger.append({ type: "succeeded", id: "a2", at: "2026-01-05T10:00:01.000Z" })
    await ledger.append({
      type: "requested",
      id: "a3",
      at: "2025-12-31T10:00:00.000Z",
      action: { ...base, idempotencyKey: "c", amountSats: 7n },
      decision: dec,
    })
    await ledger.append({ type: "succeeded", id: "a3", at: "2025-12-31T10:00:01.000Z" })
    await ledger.append({
      type: "requested",
      id: "a4",
      at: "2026-02-01T10:00:00.000Z",
      action: { ...base, idempotencyKey: "d", amountSats: 9n },
      decision: dec,
    })
    await ledger.append({ type: "failed", id: "a4", at: "2026-02-01T10:00:01.000Z", error: "x" })
    const rows = givingRows(foldEntries(await ledger.events()), 2026)
    expect(rows.map((r) => r.sats)).toEqual([500n, 1_000n])
    expect(givingStatementCsv(rows)).toBe(
      'date,recipient,slug,purpose,sats,usd,preimage\n2026-01-05,"Grace ""GF"" Church",grace-fellowship,tithe,500,,\n2026-03-01,"Grace ""GF"" Church",grace-fellowship,tithe,1000,0.83,ab\n',
    )
  })
})
