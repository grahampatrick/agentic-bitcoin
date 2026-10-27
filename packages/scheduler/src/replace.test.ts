import {
  FakeExchangeRail,
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  type ReplaceSetting,
  actionHash,
  execute,
  readEntries,
  replaceSetting,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { runReplacementsFor } from "./replace"
import { makeSweep } from "./runner"

const t0 = new Date("2026-10-27T12:00:00.000Z")
const rule: ReplaceSetting = replaceSetting({ enabled: true, since: "2026-10-27T00:00:00.000Z" })

function setup(opts: { policy?: Partial<Policy>; sweep?: boolean } = {}) {
  const ledger = new InMemoryLedgerStore()
  const exchange = new FakeExchangeRail({
    balanceCents: 100_00n,
    usdCentsPerBtc: PRICE.usdCentsPerBtc,
  })
  const wallet = new FakeWalletRail({ balanceSats: 100_000n })
  const policy: Policy = {
    ...POLICIES.open,
    confirmAboveSats: 1_000_000n,
    replaceSpend: rule,
    ...opts.policy,
  }
  const rails = { exchange, wallet }
  const paid: string[] = []
  const deps = {
    resolve: async () => ({ policy, ledger, rails }),
    price: async () => PRICE,
    now: () => t0,
    sweep: opts.sweep
      ? makeSweep(() => ({
          async payLightningInvoice(bolt11: string) {
            paid.push(bolt11)
            return { paymentId: "p1" }
          },
        }))
      : undefined,
  }
  const spend = (key: string, amountSats: bigint) =>
    execute({
      action: {
        kind: "pay_address",
        address: "gm@getalby.com",
        amountSats,
        idempotencyKey: key,
        requestedBy: "user",
      },
      policy,
      ledger,
      rails,
      now: () => new Date(t0.getTime() - 60_000),
      context: { price: PRICE },
    })
  return { ledger, exchange, wallet, policy, deps, spend, paid }
}

describe("runReplacementsFor", () => {
  it("buys back a spend once, through the ledger, and sweeps it into the wallet", async () => {
    const { ledger, deps, spend, paid } = setup({ sweep: true })
    await spend("s1", 20_000n) // ≈ $16.63 at the fixture price
    const r1 = await runReplacementsFor("u", deps)
    expect(r1.done).toHaveLength(1)
    expect(r1.done[0]).toMatchObject({ status: "succeeded", spentSats: 20_000n, swept: true })
    expect(r1.done[0]?.usdCents).toBe(1663n)
    expect(paid).toHaveLength(1)
    const entries = await readEntries(ledger)
    expect(entries.map((e) => [e.action.kind, e.outcome])).toEqual([
      ["pay_address", "succeeded"],
      ["buy_bitcoin", "succeeded"],
    ])
    expect(entries[1]?.action.idempotencyKey).toBe(`replace:${entries[0]?.id}`)
    // running again finds nothing: the ledger already holds the replacement
    expect((await runReplacementsFor("u", deps)).done).toEqual([])
  })
  it("does nothing when the rule is off, and records a denial once when the exchange rail is off", async () => {
    const off = setup({ policy: { replaceSpend: { ...rule, enabled: false } } })
    await off.spend("s1", 20_000n)
    expect((await runReplacementsFor("u", off.deps)).done).toEqual([])
    const railOff = setup({ policy: { rails: { ...POLICIES.open.rails, exchange: false } } })
    await railOff.spend("s1", 20_000n)
    const r = await runReplacementsFor("u", railOff.deps)
    expect(r.done[0]).toMatchObject({ status: "denied", detail: "RAIL_DISABLED" })
    expect((await runReplacementsFor("u", railOff.deps)).done).toEqual([]) // not retried every minute
  })
  it("a failed exchange buy is recorded and not retried", async () => {
    const s = setup()
    s.exchange = new FakeExchangeRail({ balanceCents: 0n })
    const deps = {
      ...s.deps,
      resolve: async () => ({
        policy: s.policy,
        ledger: s.ledger,
        rails: { exchange: s.exchange, wallet: s.wallet },
      }),
    }
    await s.spend("s1", 20_000n)
    const r = await runReplacementsFor("u", deps)
    expect(r.done[0]?.status).toBe("failed")
    expect((await runReplacementsFor("u", deps)).done).toEqual([])
    void actionHash
  })
})
