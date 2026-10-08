import { ACTIONS, COLD_ADDRESS, POLICIES, PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { type Action, actionHash } from "./action"
import { execute } from "./executor"
import { FakeOnChainRail } from "./fakes"
import { InMemoryLedgerStore, readEntries } from "./ledger"
import { type Policy, evaluate } from "./policy"

const allowed: Policy = { ...POLICIES.open, coldStorageAddresses: [COLD_ADDRESS] }

describe("sweep_to_cold policy", () => {
  it("is denied unless the address is allow-listed, even with an empty allow list", () => {
    expect(evaluate(ACTIONS.sweep, POLICIES.open, { spentSats: 0n })).toMatchObject({
      type: "deny",
      reason: "DESTINATION_NOT_ALLOWED",
    })
    expect(evaluate(ACTIONS.scheduleSweep, POLICIES.open, { spentSats: 0n })).toMatchObject({
      type: "deny",
      reason: "DESTINATION_NOT_ALLOWED",
    })
  })
  it("always needs confirmation when allowed, and respects the onchain rail flag and caps", () => {
    expect(evaluate(ACTIONS.sweep, allowed, { spentSats: 0n }).type).toBe("needs_confirmation")
    expect(
      evaluate(
        ACTIONS.sweep,
        { ...allowed, rails: { ...allowed.rails, onchain: false } },
        { spentSats: 0n },
      ),
    ).toMatchObject({ reason: "RAIL_DISABLED" })
    expect(
      evaluate(ACTIONS.sweep, { ...allowed, perActionCapSats: 1n }, { spentSats: 0n }),
    ).toMatchObject({ reason: "PER_ACTION_CAP" })
  })
})

describe("sweep_to_cold execution", () => {
  const run = async (action: Action, onchain: FakeOnChainRail, policy = allowed) => {
    const ledger = new InMemoryLedgerStore()
    const first = await execute({
      action,
      policy,
      ledger,
      rails: { onchain },
      context: { price: PRICE },
    })
    if (first.status !== "awaiting_confirmation") return { first, ledger }
    const res = await execute({
      action,
      policy,
      ledger,
      rails: { onchain },
      context: { price: PRICE },
      confirmation: { actionHash: actionHash(action), confirmedBy: "gm", at: "t" },
    })
    return { first, res, ledger }
  }
  it("moves everything above the keep amount, capped by maxSats, and ledgers the txid", async () => {
    const oc = new FakeOnChainRail({ confirmedSats: 1_000_000n, feeSats: 300n })
    const { res, ledger } = await run(ACTIONS.sweep, oc)
    expect(res?.status).toBe("succeeded")
    expect(oc.broadcasts[0]).toMatchObject({ address: COLD_ADDRESS, amountSats: 500_000n }) // min(800k, 500k)
    expect((await oc.getBalance()).confirmedSats).toBe(1_000_000n - 500_000n - 300n)
    const entry = (await readEntries(ledger)).find((e) => e.outcome === "succeeded")
    expect(entry?.detail).toMatch(/^swept 500000 sats, fee 300, tx [0-9a-f]{12}…$/)
  })
  it("sweeps only the excess when it is below the ceiling, and skips dust", async () => {
    const oc = new FakeOnChainRail({ confirmedSats: 250_000n })
    const { res } = await run(ACTIONS.sweep, oc)
    expect(res?.status).toBe("succeeded")
    expect(oc.broadcasts[0]?.amountSats).toBe(50_000n)
    const small = new FakeOnChainRail({ confirmedSats: 205_000n })
    const r2 = await run(ACTIONS.sweep, small)
    expect(r2.res?.status).toBe("succeeded")
    expect((r2.res as { result: { skipped: boolean } }).result.skipped).toBe(true)
    expect(small.broadcasts).toHaveLength(0)
  })
  it("refuses a malformed address even when allow-listed, before touching the rail", async () => {
    const bad = { ...ACTIONS.sweep, address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5" }
    const oc = new FakeOnChainRail({ confirmedSats: 1_000_000n })
    const { res } = await run(bad, oc, { ...allowed, coldStorageAddresses: [bad.address] })
    expect(res).toMatchObject({ status: "failed", code: "REJECTED" })
    expect(oc.broadcasts).toHaveLength(0)
  })
  it("schedule_sweep goes through the schedules hook with a validated address", async () => {
    const created: Action[] = []
    const hook = {
      create: async (a: Action) => {
        created.push(a)
        return "sch_s1"
      },
      cancel: async () => {},
    }
    const ledger = new InMemoryLedgerStore()
    const res = await execute({
      action: ACTIONS.scheduleSweep,
      policy: allowed,
      ledger,
      rails: {},
      schedules: hook,
      confirmation: { actionHash: actionHash(ACTIONS.scheduleSweep), confirmedBy: "gm", at: "t" },
    })
    expect(res).toMatchObject({ status: "succeeded", result: { scheduleId: "sch_s1" } })
    expect(created[0]?.kind).toBe("schedule_sweep")
  })
})
