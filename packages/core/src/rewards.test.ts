import { describe, expect, it } from "vitest"
import {
  DEFAULT_REWARD_RATES,
  InMemoryRewardStore,
  payoutBatches,
  rewardFor,
  rewardSink,
  summarizeRewards,
} from "./rewards"

const at = "2026-10-10T12:00:00.000Z"
const ids = (() => {
  let n = 0
  return () => `rw_${++n}`
})()

describe("rewardFor", () => {
  it("1% on directory purchases, capped, held 14 days for physical and 1 day for digital; nothing for bitrefill by default", () => {
    const r = rewardFor(
      {
        orderId: "o1",
        source: "directory",
        merchantSlug: "m",
        purchaseSats: 48_082n,
        kind: "physical",
        userId: "u1",
        at,
      },
      DEFAULT_REWARD_RATES,
      ids,
    )
    expect(r).toMatchObject({
      amountSats: 480n,
      bps: 100,
      state: "pending",
      payableAt: "2026-10-24T12:00:00.000Z",
    })
    const d = rewardFor(
      {
        orderId: "o2",
        source: "directory",
        purchaseSats: 1_000n,
        kind: "digital",
        payoutAddress: "gm@getalby.com",
        at,
      },
      DEFAULT_REWARD_RATES,
      ids,
    )
    expect(d?.payableAt).toBe("2026-10-11T12:00:00.000Z")
    expect(
      rewardFor(
        {
          orderId: "o3",
          source: "bitrefill",
          purchaseSats: 100_000n,
          kind: "digital",
          userId: "u1",
          at,
        },
        DEFAULT_REWARD_RATES,
        ids,
      ),
    ).toBeNull()
    expect(
      rewardFor(
        {
          orderId: "o4",
          source: "directory",
          purchaseSats: 50n,
          kind: "digital",
          userId: "u1",
          at,
        },
        DEFAULT_REWARD_RATES,
        ids,
      ),
    ).toBeNull() // < 1 sat
    expect(
      rewardFor(
        { orderId: "o5", source: "directory", purchaseSats: 1_000n, kind: "digital", at },
        DEFAULT_REWARD_RATES,
        ids,
      ),
    ).toBeNull() // nobody to pay
    const big = rewardFor(
      {
        orderId: "o6",
        source: "directory",
        purchaseSats: 50_000_000n,
        kind: "digital",
        userId: "u1",
        at,
      },
      DEFAULT_REWARD_RATES,
      ids,
    )
    expect(big?.amountSats).toBe(100_000n)
  })
})

describe("summary and payout batches", () => {
  it("splits pending / payable / paid and batches payable sums per payee above the minimum", async () => {
    const store = new InMemoryRewardStore()
    const sink = rewardSink(store, DEFAULT_REWARD_RATES, ids)
    await sink.accrue({
      orderId: "a",
      source: "directory",
      purchaseSats: 20_000n,
      kind: "digital",
      userId: "u1",
      at,
    })
    await sink.accrue({
      orderId: "a",
      source: "directory",
      purchaseSats: 20_000n,
      kind: "digital",
      userId: "u1",
      at,
    }) // idempotent
    await sink.accrue({
      orderId: "b",
      source: "directory",
      purchaseSats: 30_000n,
      kind: "physical",
      userId: "u1",
      at,
    })
    await sink.accrue({
      orderId: "c",
      source: "directory",
      purchaseSats: 5_000n,
      kind: "digital",
      payoutAddress: "GM@getalby.com",
      at,
    })
    await sink.accrue({
      orderId: "d",
      source: "directory",
      purchaseSats: 1_000n,
      kind: "digital",
      userId: "u2",
      at,
    })
    expect(await store.listForUser("u1")).toHaveLength(2)
    const later = new Date("2026-10-12T00:00:00.000Z")
    const s = summarizeRewards(await store.listForUser("u1"), later)
    expect(s).toMatchObject({
      payableSats: 200n,
      pendingSats: 300n,
      paidSats: 0n,
      count: 2,
      nextPayableAt: "2026-10-24T12:00:00.000Z",
    })
    const batches = payoutBatches(await store.listOpen(), later, DEFAULT_REWARD_RATES.minPayoutSats)
    expect(batches.map((b) => [b.payee.userId ?? b.payee.payoutAddress, b.totalSats])).toEqual([
      ["u1", 200n],
    ]) // u2's 10 sats and the address's 50 sats wait
    const much = new Date("2026-11-01T00:00:00.000Z")
    expect(payoutBatches(await store.listOpen(), much, 1n).map((b) => b.totalSats)).toEqual([
      500n,
      50n,
      10n,
    ])
  })
})
