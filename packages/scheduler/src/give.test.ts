import {
  FakeWalletRail,
  InMemoryLedgerStore,
  InMemoryRecipientStore,
  type Policy,
  readEntries,
  recipientsForUser,
} from "@agentic-bitcoin/core"
import { PRICE, RECIPIENTS } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { runDue, schedulesHook } from "./runner"
import { InMemoryScheduleStore } from "./schedule"

const policy: Policy = {
  dailyCapSats: 1_000_000n,
  perActionCapSats: 500_000n,
  confirmAboveSats: 1_000_000n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: true, goods: true, compute: true, onchain: true },
}
const sunday14 = new Date("2026-10-11T14:00:30.000Z") // a Sunday

function world() {
  const schedules = new InMemoryScheduleStore()
  const ledger = new InMemoryLedgerStore()
  const wallet = new FakeWalletRail()
  const directory = new InMemoryRecipientStore(Object.values(RECIPIENTS))
  const deps = {
    schedules,
    resolve: async () => ({ policy, ledger, rails: { wallet } }),
    price: async () => PRICE,
    recipients: (userId: string) => recipientsForUser(directory, userId),
    now: () => sunday14,
  }
  return { schedules, ledger, wallet, directory, deps }
}

describe("recurring gifts", () => {
  it("schedule_give persists a give schedule and the runner pays it as a pre-approved give", async () => {
    const w = world()
    const hook = schedulesHook(w.schedules)
    const id = await hook.create({
      kind: "schedule_give",
      idempotencyKey: "u1:call",
      requestedBy: "agent",
      recipientSlug: "grace-fellowship",
      recipientName: "Grace Fellowship Church",
      address: "give@grace-fellowship.example",
      verified: true,
      amountSats: 1_000n,
      cron: "0 14 * * 0",
      purpose: "tithe",
    })
    const s = await w.schedules.get(id)
    expect(s).toMatchObject({
      kind: "give",
      recipientSlug: "grace-fellowship",
      estimatedSats: 1_000n,
    })
    const report = await runDue(w.deps)
    expect(report.fired).toHaveLength(1)
    expect(report.fired[0]?.status).toBe("succeeded")
    expect(report.fired[0]?.detail).toContain("grace-fellowship")
    const entries = await readEntries(w.ledger)
    expect(entries[0]?.action).toMatchObject({
      kind: "give",
      requestedBy: "schedule",
      purpose: "tithe",
      verified: true,
    })
    expect(entries[0]?.outcome).toBe("succeeded")
  })

  it("re-prices a dollar-denominated gift at fire time", async () => {
    const w = world()
    await w.schedules.create({
      userId: "u1",
      kind: "give",
      exchange: "strike",
      usdCents: 500n,
      address: "give@grace-fellowship.example",
      recipientSlug: "grace-fellowship",
      recipientName: "Grace Fellowship Church",
      purpose: "support",
      verified: true,
      cron: "0 14 * * 0",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    await runDue(w.deps)
    const [e] = await readEntries(w.ledger)
    expect(e?.action.kind === "give" && e.action.amountSats).toBe(6_011n) // $5 at the fixture price
  })

  it("pauses the schedule when the recipient has vanished, and denies when trust was revoked", async () => {
    const w = world()
    await w.schedules.create({
      userId: "u1",
      kind: "give",
      exchange: "strike",
      usdCents: 0n,
      address: "hello@new-church.example",
      recipientSlug: "new-church",
      recipientName: "New Church (pending)",
      purpose: "gift",
      verified: true, // was trusted at creation; the directory now says unverified
      cron: "0 14 * * 0",
      estimatedSats: 100n,
      sweepToWallet: false,
    })
    const r1 = await runDue(w.deps)
    expect(r1.fired[0]?.status).toBe("denied")
    expect(r1.fired[0]?.detail).toBe("RECIPIENT_UNVERIFIED")

    await w.directory.remove("new-church")
    await w.schedules.create({
      userId: "u1",
      kind: "give",
      exchange: "strike",
      usdCents: 0n,
      address: "hello@new-church.example",
      recipientSlug: "new-church",
      purpose: "gift",
      verified: true,
      cron: "0 14 * * 0",
      estimatedSats: 100n,
      sweepToWallet: false,
    })
    const r2 = await runDue({ ...w.deps, now: () => new Date("2026-10-18T14:00:00.000Z") })
    // both schedules point at the vanished recipient: both pause, nothing is paid
    const paused = r2.fired.filter((f) => f.detail?.includes("paused"))
    expect(paused).toHaveLength(2)
    expect(paused.every((f) => f.status === "failed")).toBe(true)
    expect(
      (await w.schedules.listActive()).filter((s) => s.recipientSlug === "new-church"),
    ).toHaveLength(0)
    expect((await readEntries(w.ledger)).filter((e) => e.outcome === "succeeded")).toHaveLength(0)
  })
})
