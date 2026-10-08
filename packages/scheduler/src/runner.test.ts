import {
  type Action,
  FakeExchangeRail,
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { makeSweep, runDue, schedulesHook, slotOf } from "./runner"
import { InMemoryScheduleStore } from "./schedule"

const policy: Policy = { ...POLICIES.open, confirmAboveSats: 1_000_000n }

function setup(opts: { exchange?: FakeExchangeRail; policy?: Policy; cron?: string } = {}) {
  const store = new InMemoryScheduleStore()
  const ledger = new InMemoryLedgerStore()
  const exchange = opts.exchange ?? new FakeExchangeRail({ balanceCents: 100_00n })
  const wallet = new FakeWalletRail({ balanceSats: 0n })
  const log: string[] = []
  const deps = (now: Date) => ({
    schedules: store,
    resolve: async () => ({ policy: opts.policy ?? policy, ledger, rails: { exchange, wallet } }),
    price: async () => PRICE,
    now: () => now,
    log: (l: string) => log.push(l),
  })
  return { store, ledger, exchange, wallet, log, deps }
}

const t0 = new Date("2026-10-09T14:00:10.000Z") // Friday 14:00 UTC

describe("runDue", () => {
  it("fires a due schedule once per slot as a schedule-requested buy, through policy and the ledger", async () => {
    const { store, ledger, deps, exchange } = setup()
    await store.create({
      userId: "u",
      kind: "buy",
      exchange: "strike",
      usdCents: 25_00n,
      cron: "0 14 * * 5",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    const r1 = await runDue(deps(t0))
    expect(r1.fired).toHaveLength(1)
    expect(r1.fired[0]).toMatchObject({ status: "succeeded", detail: "30059 sats for 2500 cents" })
    const again = await runDue(deps(new Date("2026-10-09T14:00:50.000Z"))) // same minute → nothing
    expect(again.fired).toHaveLength(0)
    const [e] = await readEntries(ledger)
    expect(e?.action).toMatchObject({
      kind: "buy_bitcoin",
      requestedBy: "schedule",
      usdCents: 25_00n,
      estimatedSats: 30_059n,
    })
    expect(e?.action.idempotencyKey).toBe(`sch_1:${slotOf(t0)}`)
    expect((await store.get("sch_1"))?.lastRunAt).toBe("2026-10-09T14:00:00.000Z")
    expect(exchange).toBeDefined()
  })
  it("does not fire when the cron does not match or the schedule is cancelled", async () => {
    const { store, deps } = setup()
    const s = await store.create({
      userId: "u",
      kind: "buy",
      exchange: "strike",
      usdCents: 25_00n,
      cron: "0 14 * * 5",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    expect((await runDue(deps(new Date("2026-10-09T15:00:00.000Z")))).fired).toHaveLength(0)
    await store.cancel(s.id)
    expect((await runDue(deps(t0))).fired).toHaveLength(0)
  })
  it("a denied run is ledgered and the slot is still claimed (no retry storm)", async () => {
    const { store, ledger, deps } = setup({
      policy: { ...policy, rails: { ...policy.rails, exchange: false } },
    })
    await store.create({
      userId: "u",
      kind: "buy",
      exchange: "strike",
      usdCents: 25_00n,
      cron: "* * * * *",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    const r = await runDue(deps(t0))
    expect(r.fired[0]).toMatchObject({ status: "denied", detail: "RAIL_DISABLED" })
    expect((await readEntries(ledger))[0]?.outcome).toBe("denied")
    expect((await runDue(deps(new Date("2026-10-09T14:00:59.000Z")))).fired).toHaveLength(0)
  })
  it("an exchange failure is recorded, and the next slot tries again", async () => {
    const exchange = new FakeExchangeRail({ balanceCents: 1_00n }) // too poor
    const { store, ledger, deps } = setup({ exchange })
    await store.create({
      userId: "u",
      kind: "buy",
      exchange: "strike",
      usdCents: 25_00n,
      cron: "* * * * *",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    expect((await runDue(deps(t0))).fired[0]).toMatchObject({ status: "failed" })
    expect((await runDue(deps(new Date("2026-10-09T14:01:00.000Z")))).fired).toHaveLength(1)
    expect((await readEntries(ledger)).map((e) => e.outcome)).toEqual(["failed", "failed"])
  })
  it("a schedule with a bad cron is cancelled rather than crashing the runner", async () => {
    const { store, deps, log } = setup()
    const s = await store.create({
      userId: "u",
      kind: "buy",
      exchange: "strike",
      usdCents: 1n,
      cron: "nope",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    await runDue(deps(t0))
    expect((await store.get(s.id))?.active).toBe(false)
    expect(log[0]).toContain("bad cron")
  })
  it("sweeps bought sats to the wallet when enabled", async () => {
    const { store, deps, wallet } = setup()
    await store.create({
      userId: "u",
      kind: "buy",
      exchange: "strike",
      usdCents: 25_00n,
      cron: "* * * * *",
      estimatedSats: 1n,
      sweepToWallet: true,
    })
    const paid: string[] = []
    const sweep = makeSweep(() => ({
      payLightningInvoice: async (bolt11: string) => {
        paid.push(bolt11)
        return { paymentId: "pay-1" }
      },
    }))
    const r = await runDue({ ...deps(t0), sweep })
    expect(r.fired[0]?.status).toBe("succeeded")
    expect(paid).toHaveLength(1)
    expect(paid[0]).toMatch(/^lnbc30059n1fake/)
    expect(wallet).toBeDefined()
  })
})

describe("scheduled sweeps (M8)", () => {
  it("fires a sweep as a pre-approved schedule action and ledgers the txid", async () => {
    const { FakeOnChainRail } = await import("@agentic-bitcoin/core")
    const { COLD_ADDRESS } = await import("@agentic-bitcoin/fixtures")
    const store = new InMemoryScheduleStore()
    const ledger = new InMemoryLedgerStore()
    const onchain = new FakeOnChainRail({ confirmedSats: 1_000_000n })
    await store.create({
      userId: "u",
      kind: "sweep",
      exchange: "strike",
      usdCents: 0n,
      address: COLD_ADDRESS,
      keepSats: 200_000n,
      maxSats: 500_000n,
      cron: "0 3 1 * *",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    const r = await runDue({
      schedules: store,
      resolve: async () => ({
        policy: { ...policy, coldStorageAddresses: [COLD_ADDRESS] },
        ledger,
        rails: { onchain },
      }),
      price: async () => PRICE,
      now: () => new Date("2026-11-01T03:00:10.000Z"),
    })
    expect(r.fired[0]).toMatchObject({
      status: "succeeded",
      detail: expect.stringMatching(/^swept 500000 sats, tx/),
    })
    expect(onchain.broadcasts[0]?.amountSats).toBe(500_000n)
    expect((await readEntries(ledger))[0]?.action).toMatchObject({
      kind: "sweep_to_cold",
      requestedBy: "schedule",
    })
  })
  it("a sweep to an address that is no longer allow-listed is denied at fire time", async () => {
    const { FakeOnChainRail } = await import("@agentic-bitcoin/core")
    const { COLD_ADDRESS } = await import("@agentic-bitcoin/fixtures")
    const store = new InMemoryScheduleStore()
    await store.create({
      userId: "u",
      kind: "sweep",
      exchange: "strike",
      usdCents: 0n,
      address: COLD_ADDRESS,
      keepSats: 0n,
      maxSats: 1n,
      cron: "* * * * *",
      estimatedSats: 1n,
      sweepToWallet: false,
    })
    const r = await runDue({
      schedules: store,
      resolve: async () => ({
        policy,
        ledger: new InMemoryLedgerStore(),
        rails: { onchain: new FakeOnChainRail({ confirmedSats: 10n }) },
      }),
      price: async () => PRICE,
      now: () => new Date("2026-11-01T03:00:10.000Z"),
    })
    expect(r.fired[0]).toMatchObject({ status: "denied", detail: "DESTINATION_NOT_ALLOWED" })
  })
})

describe("schedulesHook through the executor", () => {
  it("schedule_buy creates a row for the user and cancel_schedule deactivates it", async () => {
    const store = new InMemoryScheduleStore()
    const ledger = new InMemoryLedgerStore()
    const hook = schedulesHook(store)
    const create: Action = {
      kind: "schedule_buy",
      exchange: "strike",
      usdCents: 25_00n,
      cron: "0 14 * * 5",
      estimatedSats: 30_059n,
      idempotencyKey: "u1:tu_1",
      requestedBy: "agent",
    }
    const r = await execute({ action: create, policy, ledger, rails: {}, schedules: hook })
    expect(r).toMatchObject({ status: "succeeded", result: { scheduleId: "sch_1" } })
    expect((await store.listForUser("u1"))[0]).toMatchObject({
      userId: "u1",
      cron: "0 14 * * 5",
      active: true,
      sweepToWallet: false,
    })
    const cancel: Action = {
      kind: "cancel_schedule",
      scheduleId: "sch_1",
      idempotencyKey: "u1:tu_2",
      requestedBy: "agent",
    }
    expect(
      (await execute({ action: cancel, policy, ledger, rails: {}, schedules: hook })).status,
    ).toBe("succeeded")
    expect((await store.get("sch_1"))?.active).toBe(false)
  })
  it("rejects a bad cron before persisting", async () => {
    const store = new InMemoryScheduleStore()
    const bad: Action = {
      kind: "schedule_buy",
      exchange: "strike",
      usdCents: 1n,
      cron: "every friday",
      estimatedSats: 1n,
      idempotencyKey: "u1:x",
      requestedBy: "agent",
    }
    const r = await execute({
      action: bad,
      policy,
      ledger: new InMemoryLedgerStore(),
      rails: {},
      schedules: schedulesHook(store),
    })
    expect(r.status).toBe("failed")
    expect(await store.listActive()).toHaveLength(0)
  })
})
