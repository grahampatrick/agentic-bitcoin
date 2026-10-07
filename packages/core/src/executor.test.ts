import { ACTIONS, L402, POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { type Action, actionHash } from "./action"
import { type Confirmation, execute } from "./executor"
import { FakeExchangeRail, FakeGoodsRail, FakeWalletRail } from "./fakes"
import { InMemoryLedgerStore, readEntries } from "./ledger"
import type { Policy } from "./policy"
import { type ComputeRail, RailError, type Rails } from "./rails"

const now = clockAt()
let n = 0
const newId = () => `id_${++n}`

function setup(policy: Policy = POLICIES.open, rails: Partial<Rails> = {}) {
  const ledger = new InMemoryLedgerStore()
  const wallet = new FakeWalletRail({ balanceSats: 1_000_000n, now })
  const r: Rails = {
    wallet,
    exchange: new FakeExchangeRail({ now }),
    goods: new FakeGoodsRail(),
    ...rails,
  }
  const run = (action: Action, extra: { confirmation?: Confirmation; policy?: Policy } = {}) =>
    execute({
      action,
      policy: extra.policy ?? policy,
      ledger,
      rails: r,
      now,
      newId,
      confirmation: extra.confirmation,
      context: { price: PRICE },
    })
  return { ledger, wallet, rails: r, run }
}

describe("execute: policy before rail", () => {
  it("a read succeeds and is recorded", async () => {
    const { run, ledger } = setup()
    const res = await run(ACTIONS.balance)
    expect(res.status).toBe("succeeded")
    const [e] = await readEntries(ledger)
    expect(e).toMatchObject({
      outcome: "succeeded",
      action: ACTIONS.balance,
      detail: "1000000 sats",
    })
  })
  it("a denied action never touches the wallet and is recorded as denied", async () => {
    const { run, wallet, ledger } = setup(POLICIES.killed)
    const res = await run(ACTIONS.tip)
    expect(res).toMatchObject({ status: "denied", decision: { reason: "KILL_SWITCH" } })
    expect((await wallet.getBalance()).sats).toBe(1_000_000n)
    expect((await readEntries(ledger))[0]?.outcome).toBe("denied")
  })
  it("pays a lightning address, debits the fake, stores the preimage", async () => {
    const { run, wallet, ledger } = setup()
    const res = await run(ACTIONS.tip)
    expect(res.status).toBe("succeeded")
    expect((await wallet.getBalance()).sats).toBe(1_000_000n - 21n - 1n)
    const [e] = await readEntries(ledger)
    expect(e?.preimage).toMatch(/^[0-9a-f]{64}$/)
  })
  it("a failing payment is recorded as failed with the rail's code", async () => {
    const { run, ledger } = setup()
    const res = await run(ACTIONS.payFailing)
    expect(res).toMatchObject({ status: "failed", code: "REJECTED" })
    expect((await readEntries(ledger))[0]).toMatchObject({
      outcome: "failed",
      error: "payment failed",
    })
  })
  it("a missing rail is a typed failure, not a crash", async () => {
    const { run } = setup(POLICIES.open, { exchange: undefined })
    const res = await run(ACTIONS.dca, {
      policy: { ...POLICIES.open, confirmAboveSats: 10_000_000n },
    })
    expect(res).toMatchObject({ status: "failed", code: "BAD_CONFIG" })
  })
})

describe("execute: confirmation binding", () => {
  it("stops and asks when policy says so, recording awaiting_confirmation", async () => {
    const { run, ledger, wallet } = setup()
    const res = await run(ACTIONS.giftCard)
    expect(res.status).toBe("awaiting_confirmation")
    if (res.status !== "awaiting_confirmation") throw new Error()
    expect(res.decision.summary).toContain("12,100 sats")
    expect(res.decision.summary).toContain("$10.06") // rounds down from 1,006.3 cents
    expect((await readEntries(ledger))[0]?.outcome).toBe("awaiting_confirmation")
    expect((await wallet.getBalance()).sats).toBe(1_000_000n)
  })
  it("executes with a matching confirmation hash", async () => {
    const { run, rails } = setup()
    const first = await run(ACTIONS.giftCard)
    if (first.status !== "awaiting_confirmation") throw new Error()
    const res = await run(ACTIONS.giftCard, {
      confirmation: { actionHash: first.decision.actionHash, confirmedBy: "gm", at: "t" },
    })
    expect(res.status).toBe("succeeded")
    const result = (res as { result: { order: { state: string } } }).result
    expect(result.order.state).toBe("unpaid") // payment is not delivery; the fake hasn't observed it yet
    expect(rails.goods).toBeDefined()
  })
  it("rejects a confirmation for a different action (tampered amount)", async () => {
    const { run, wallet } = setup()
    const tampered: Action = { ...ACTIONS.giftCard, amountSats: 120_200n }
    const res = await run(tampered, {
      confirmation: { actionHash: actionHash(ACTIONS.giftCard), confirmedBy: "gm", at: "t" },
    })
    expect(res.status).toBe("awaiting_confirmation")
    expect((await wallet.getBalance()).sats).toBe(1_000_000n)
  })
})

describe("execute: idempotent replay", () => {
  it("the same key twice pays once and returns the original result", async () => {
    const { run, wallet, ledger } = setup()
    const a = await run(ACTIONS.tip)
    const b = await run(ACTIONS.tip)
    expect(a.status).toBe("succeeded")
    expect(b).toMatchObject({ status: "succeeded", replayed: true, id: a.id })
    expect((await wallet.getBalance()).sats).toBe(1_000_000n - 22n)
    expect(await readEntries(ledger)).toHaveLength(1)
  })
  it("a failed key may be retried", async () => {
    const { run, ledger } = setup()
    await run(ACTIONS.payFailing)
    await run(ACTIONS.payFailing)
    expect((await readEntries(ledger)).filter((e) => e.outcome === "failed")).toHaveLength(2)
  })
  it("a denied key may be retried after the policy loosens", async () => {
    const { run } = setup({ ...POLICIES.open, perActionCapSats: 1n })
    expect((await run(ACTIONS.tip)).status).toBe("denied")
    expect((await run(ACTIONS.tip, { policy: POLICIES.open })).status).toBe("succeeded")
  })
})

describe("execute: daily cap from the ledger window", () => {
  it("exhausts the cap across several actions and then denies", async () => {
    const policy: Policy = { ...POLICIES.open, dailyCapSats: 60n, perActionCapSats: 60n }
    const { run } = setup(policy)
    const mk = (i: number): Action => ({ ...ACTIONS.tip, idempotencyKey: `tip-${i}` })
    expect((await run(mk(1))).status).toBe("succeeded") // 21
    expect((await run(mk(2))).status).toBe("succeeded") // 42
    const third = await run(mk(3)) // 63 > 60
    expect(third).toMatchObject({ status: "denied", decision: { reason: "DAILY_CAP" } })
  })
  it("failed payments do not consume budget; in-flight ones do", async () => {
    const policy: Policy = { ...POLICIES.open, dailyCapSats: 30n, perActionCapSats: 30n }
    const { run, ledger } = setup(policy)
    await run(ACTIONS.payFailing) // 21 requested, failed → not counted
    expect((await run(ACTIONS.tip)).status).toBe("succeeded")
    // simulate an in-flight payment left pending by a crash
    await ledger.append({
      type: "requested",
      id: "crash",
      at: now().toISOString(),
      action: { ...ACTIONS.tip, idempotencyKey: "crash" },
      decision: { type: "allow", summary: "" },
    })
    await ledger.append({ type: "started", id: "crash", at: now().toISOString() })
    const res = await run({ ...ACTIONS.tip, idempotencyKey: "tip-after-crash" })
    expect(res).toMatchObject({ status: "denied", decision: { reason: "DAILY_CAP" } })
  })
  it("spend older than 24h falls out of the window", async () => {
    const policy: Policy = { ...POLICIES.open, dailyCapSats: 30n, perActionCapSats: 30n }
    const ledger = new InMemoryLedgerStore()
    const rails: Rails = { wallet: new FakeWalletRail({ now }) }
    const at = (iso: string) => clockAt(iso)
    const a = await execute({
      action: ACTIONS.tip,
      policy,
      ledger,
      rails,
      now: at("2026-10-06T11:00:00.000Z"),
      newId,
    })
    expect(a.status).toBe("succeeded")
    const b = await execute({
      action: { ...ACTIONS.tip, idempotencyKey: "later" },
      policy,
      ledger,
      rails,
      now: at("2026-10-07T12:00:00.000Z"),
      newId,
    })
    expect(b.status).toBe("succeeded")
  })
})

describe("execute: unknown state", () => {
  it("keeps the entry pending (budget reserved) when the rail cannot say whether money moved", async () => {
    const wallet = new FakeWalletRail({ now })
    const unknown: typeof wallet = Object.assign(
      Object.create(Object.getPrototypeOf(wallet)),
      wallet,
      {
        payInvoice: async () => {
          throw new RailError("nwc", "UNKNOWN_STATE", "maybe in flight")
        },
      },
    )
    const { run, ledger } = setup(POLICIES.open, { wallet: unknown })
    const res = await run(ACTIONS.tip)
    expect(res).toMatchObject({ status: "failed", code: "UNKNOWN_STATE" })
    const [e] = await readEntries(ledger)
    expect(e?.outcome).toBe("pending")
    // a retry with the same key is replayed, never re-paid
    const again = await run(ACTIONS.tip)
    expect(again).toMatchObject({ status: "succeeded", replayed: true })
  })
})

describe("execute: exchange, schedules, compute", () => {
  it("buys bitcoin: quote → execute in one call", async () => {
    const { run } = setup({ ...POLICIES.open, confirmAboveSats: 10_000_000n })
    const res = await run(ACTIONS.dca)
    expect(res.status).toBe("succeeded")
    expect((res as { result: { sats: bigint } }).result.sats).toBe(30_059n)
  })
  it("schedules and cancels through the injected store", async () => {
    const created: Action[] = []
    const cancelled: string[] = []
    const schedules = {
      create: async (a: Action) => {
        created.push(a)
        return "sch_1"
      },
      cancel: async (id: string) => {
        cancelled.push(id)
      },
    }
    const ledger = new InMemoryLedgerStore()
    const policy: Policy = { ...POLICIES.open, confirmAboveSats: 10_000_000n }
    const s = await execute({
      action: ACTIONS.schedule,
      policy,
      ledger,
      rails: {},
      schedules,
      now,
      newId,
    })
    expect(s).toMatchObject({ status: "succeeded", result: { scheduleId: "sch_1" } })
    const c = await execute({
      action: ACTIONS.cancel,
      policy,
      ledger,
      rails: {},
      schedules,
      now,
      newId,
    })
    expect(c.status).toBe("succeeded")
    expect(created).toHaveLength(1)
    expect(cancelled).toEqual(["sch_1"])
  })
  it("pays an L402 challenge within budget and retries with the token", async () => {
    const calls: string[] = []
    const compute: ComputeRail = {
      kind: "fake-compute",
      async request(url) {
        calls.push(`GET ${url}`)
        return {
          status: 402 as const,
          challenge: {
            macaroon: L402.macaroon,
            invoice: L402.invoice,
            amountSats: L402.amountSats,
          },
        }
      },
      async requestWithToken(url, token) {
        calls.push(`GET ${url} ${L402.authorization(token.macaroon, token.preimage).slice(0, 30)}`)
        return { status: 200, body: '{"ok":true}', headers: {} }
      },
    }
    const { run, wallet } = setup(POLICIES.open, { compute })
    const res = await run(ACTIONS.compute)
    expect(res.status).toBe("succeeded")
    expect(calls).toHaveLength(2)
    expect((await wallet.getBalance()).sats).toBe(1_000_000n - 10n - 1n)
  })
  it("refuses an L402 challenge above the approved amount", async () => {
    const compute: ComputeRail = {
      kind: "fake-compute",
      async request() {
        return {
          status: 402 as const,
          challenge: { macaroon: "m", invoice: L402.invoice, amountSats: 51n },
        }
      },
      async requestWithToken() {
        throw new Error("must not be called")
      },
    }
    const { run, wallet } = setup(POLICIES.open, { compute })
    const res = await run(ACTIONS.compute)
    expect(res).toMatchObject({ status: "failed", code: "AMOUNT_OUT_OF_RANGE" })
    expect((await wallet.getBalance()).sats).toBe(1_000_000n)
  })
  it("refuses a merchant order priced above the approved sats", async () => {
    const goods = new FakeGoodsRail(1_000_000n) // absurd price: $1 = 10,000 sats... wait: cents per BTC = $10,000 → more sats per dollar
    const { run, wallet } = setup(POLICIES.open, { goods })
    const first = await run(ACTIONS.giftCard)
    if (first.status !== "awaiting_confirmation") throw new Error()
    const res = await run(ACTIONS.giftCard, {
      confirmation: { actionHash: first.decision.actionHash, confirmedBy: "gm", at: "t" },
    })
    expect(res).toMatchObject({ status: "failed", code: "AMOUNT_OUT_OF_RANGE" })
    expect((await wallet.getBalance()).sats).toBe(1_000_000n)
  })
})
