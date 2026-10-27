import {
  type Action,
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { runDue, schedulesHook } from "./runner"
import { InMemoryScheduleStore } from "./schedule"

const policy: Policy = { ...POLICIES.open, confirmAboveSats: 1_000n }
const t0 = new Date("2026-11-01T14:00:05.000Z") // the 1st, 14:00 UTC

function setup() {
  const store = new InMemoryScheduleStore()
  const ledger = new InMemoryLedgerStore()
  const wallet = new FakeWalletRail({ balanceSats: 1_000_000n })
  const asked: { userId: string; action: Action; summary: string }[] = []
  const deps = (now: Date, withAsk = true) => ({
    schedules: store,
    resolve: async () => ({ policy, ledger, rails: { wallet } }),
    price: async () => PRICE,
    now: () => now,
    ask: withAsk
      ? async (userId: string, action: Action, summary: string) => {
          asked.push({ userId, action, summary })
          return `asked: ${summary}`
        }
      : undefined,
  })
  const hook = schedulesHook(store, { userId: "u" })
  const schedule = (mode: "auto" | "ask", usdCents: bigint, amountSats: bigint) =>
    execute({
      action: {
        kind: "schedule_bill",
        name: "Rent",
        address: "landlord@example.com",
        amountSats,
        usdCents: usdCents > 0n ? usdCents : undefined,
        cron: "0 14 1 * *",
        mode,
        idempotencyKey: `u:bill-${mode}`,
        requestedBy: "agent",
      },
      policy,
      ledger,
      rails: { wallet },
      schedules: hook,
      now: () => new Date("2026-10-27T12:00:00Z"),
      context: { price: PRICE },
    })
  return { store, ledger, wallet, deps, hook, schedule, asked }
}

describe("bills", () => {
  it("scheduling a bill needs a yes, then lists as a bill", async () => {
    const { schedule, hook, ledger } = setup()
    const r1 = await schedule("auto", 4500n, 54_106n)
    expect(r1.status).toBe("awaiting_confirmation")
    expect(r1.decision.summary).toContain("Schedule the bill “Rent” to landlord@example.com")
    const r2 = await execute({
      action: (await readEntries(ledger))[0]?.action as Action,
      policy,
      ledger,
      rails: {},
      schedules: hook,
      confirmation: {
        actionHash: (r1.decision as { actionHash: string }).actionHash,
        confirmedBy: "u",
        at: "",
      },
    })
    expect(r2.status).toBe("succeeded")
    const list = await hook.list()
    expect(list[0]).toMatchObject({ kind: "bill", cron: "0 14 1 * *", active: true })
    expect(list[0]?.summary).toBe("Bill “Rent” $45 to landlord@example.com")
  })
  it("an auto bill pays the address on the day, re-priced from dollars, once per slot", async () => {
    const { store, ledger, wallet, deps } = setup()
    await store.create({
      userId: "u",
      kind: "bill",
      exchange: "strike",
      usdCents: 4500n,
      address: "landlord@example.com",
      bill: { name: "Rent", mode: "auto" },
      cron: "0 14 1 * *",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    const r = await runDue(deps(t0))
    expect(r.fired).toHaveLength(1)
    expect(r.fired[0]?.status).toBe("succeeded")
    const [e] = await readEntries(ledger)
    expect(e?.action).toMatchObject({
      kind: "pay_address",
      address: "landlord@example.com",
      memo: "Rent",
      requestedBy: "schedule",
    })
    expect((e?.action as { amountSats: bigint }).amountSats).toBe(54_106n) // $45 at the fixture price
    expect((await wallet.getBalance()).sats).toBeLessThan(1_000_000n - 54_000n)
    expect((await runDue(deps(new Date("2026-11-01T14:00:50Z")))).fired).toEqual([])
  })
  it("an ask bill parks the payment and asks instead of paying; without an asker it is noted", async () => {
    const { store, ledger, deps, asked } = setup()
    await store.create({
      userId: "u",
      kind: "bill",
      exchange: "strike",
      usdCents: 0n,
      address: "bills@carrier.example",
      bill: { name: "Phone plan", mode: "ask", memo: "acct 42" },
      cron: "0 14 1 * *",
      estimatedSats: 20_000n,
      sweepToWallet: false,
    })
    const r = await runDue(deps(t0))
    expect(r.fired[0]).toMatchObject({
      status: "awaiting_confirmation",
      detail: "asked: Bill “Phone plan”: 20,000 sats to bills@carrier.example",
    })
    expect(asked[0]?.action).toMatchObject({
      kind: "pay_address",
      amountSats: 20_000n,
      memo: "acct 42",
    })
    expect(await readEntries(ledger)).toEqual([]) // nothing moved, nothing ledgered until the yes
    // a month later, with no one to ask, the firing is recorded as failed and not retried in the slot
    const r2 = await runDue(deps(new Date("2026-12-01T14:00:05Z"), false))
    expect(r2.fired[0]).toMatchObject({
      status: "failed",
      detail: expect.stringContaining("no one to ask"),
    })
  })
})
