import {
  DEFAULT_REWARD_RATES,
  FakeWalletRail,
  InMemoryLedgerStore,
  InMemoryRewardStore,
  type Policy,
  readEntries,
  rewardSink,
} from "@agentic-bitcoin/core"
import { describe, expect, it } from "vitest"
import { runRewardPayouts } from "./rewards"

const policy: Policy = {
  dailyCapSats: 1_000n,
  perActionCapSats: 1_000n,
  confirmAboveSats: 1_000_000n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: false, goods: false, compute: false, onchain: false },
}
let n = 0
const ids = () => `rw_${++n}`
const at = "2026-10-01T00:00:00.000Z"

describe("runRewardPayouts", () => {
  it("pays payable batches from the operator wallet through the executor, marks them paid, and respects the operator's caps", async () => {
    const store = new InMemoryRewardStore()
    const sink = rewardSink(store, DEFAULT_REWARD_RATES, ids)
    await sink.accrue({
      orderId: "a",
      source: "directory",
      purchaseSats: 30_000n,
      kind: "digital",
      userId: "u1",
      at,
    })
    await sink.accrue({
      orderId: "b",
      source: "directory",
      purchaseSats: 20_000n,
      kind: "digital",
      userId: "u1",
      at,
    })
    await sink.accrue({
      orderId: "c",
      source: "directory",
      purchaseSats: 90_000n,
      kind: "digital",
      payoutAddress: "web@getalby.com",
      at,
    })
    await sink.accrue({
      orderId: "d",
      source: "directory",
      purchaseSats: 50_000n,
      kind: "physical",
      userId: "u2",
      at,
    }) // held 14 days
    const ledger = new InMemoryLedgerStore()
    const wallet = new FakeWalletRail()
    const invoices: string[] = []
    const deps = {
      store,
      rates: DEFAULT_REWARD_RATES,
      operator: { policy, ledger, rails: { wallet } },
      invoiceFor: async (p: { userId?: string; payoutAddress?: string }, sats: bigint) => {
        invoices.push(`${p.userId ?? p.payoutAddress}:${sats}`)
        return p.userId === "u2" ? null : { bolt11: `lnbc${sats}n1reward${p.userId ?? "addr"}` }
      },
      now: () => new Date("2026-10-03T00:00:00.000Z"),
    }
    const r1 = await runRewardPayouts(deps)
    expect(invoices).toEqual(["u1:500", "web@getalby.com:900"])
    expect(r1.paid.map((p) => [p.payee, p.sats])).toEqual([["u1", 500n]])
    expect(r1.skipped[0]).toMatchObject({
      payee: "web@getalby.com",
      reason: expect.stringContaining("DAILY_CAP"),
    })
    expect((await store.listForUser("u1")).every((r) => r.state === "paid" && r.paymentHash)).toBe(
      true,
    )
    expect((await store.listForAddress("web@getalby.com"))[0]?.state).toBe("payable")
    const entries = await readEntries(ledger)
    expect(entries.filter((e) => e.outcome === "succeeded")).toHaveLength(1)
    expect(entries[0]?.action).toMatchObject({
      kind: "pay_invoice",
      destination: "reward:u1",
      requestedBy: "schedule",
    })
    // next day: the cap has room again, the address batch is paid; u1 is not paid twice
    const r2 = await runRewardPayouts({ ...deps, now: () => new Date("2026-10-05T00:00:00.000Z") })
    expect(r2.paid.map((p) => p.payee)).toEqual(["web@getalby.com"])
    expect((await store.listOpen()).map((r) => r.orderId)).toEqual(["d"])
  })
})
