import { describe, expect, it } from "vitest"
import type { Action } from "./action"
import type { LedgerEntry } from "./ledger"
import type { PriceSnapshot } from "./money"
import { DEFAULT_REPLACE, type ReplaceSetting, isReplacement, replacementsDue } from "./replace"

const price: PriceSnapshot = {
  usdCentsPerBtc: 100_000_00n,
  asOf: "2026-10-27T00:00:00Z",
  source: "test",
} // $100k: 1 sat = 0.1¢
const now = new Date("2026-10-27T12:00:00.000Z")
const setting: ReplaceSetting = {
  ...DEFAULT_REPLACE,
  enabled: true,
  since: "2026-10-27T00:00:00.000Z",
}

const pay = (
  id: string,
  at: string,
  amountSats: bigint,
  outcome: LedgerEntry["outcome"] = "succeeded",
): LedgerEntry => ({
  id,
  at,
  action: {
    kind: "pay_address",
    address: "gm@getalby.com",
    amountSats,
    idempotencyKey: id,
    requestedBy: "user",
  },
  decision: { type: "allow", summary: "" },
  outcome,
})
const replacement = (
  entryId: string,
  at: string,
  usdCents: bigint,
  outcome: LedgerEntry["outcome"],
): LedgerEntry => ({
  id: `r_${entryId}`,
  at,
  action: {
    kind: "buy_bitcoin",
    exchange: "strike",
    usdCents,
    estimatedSats: 0n,
    idempotencyKey: `replace:${entryId}`,
    requestedBy: "schedule",
  },
  decision: { type: "allow", summary: "" },
  outcome,
})

describe("replacementsDue", () => {
  it("is off by default and skips spends before the rule was turned on", () => {
    const e = [pay("a", "2026-10-26T23:00:00Z", 5_000n), pay("b", "2026-10-27T10:00:00Z", 5_000n)]
    expect(replacementsDue(e, { ...setting, enabled: false }, price, now)).toEqual([])
    expect(replacementsDue(e, setting, price, now).map((d) => d.entry.id)).toEqual(["b"])
  })
  it("prices a spend in cents at the percentage, keys the buy to the entry, and never repeats one", () => {
    const e = [pay("a", "2026-10-27T10:00:00Z", 5_000n)] // 5,000 sats = $5.00
    const [d] = replacementsDue(e, setting, price, now)
    expect(d?.action).toMatchObject({
      kind: "buy_bitcoin",
      usdCents: 500n,
      estimatedSats: 5_000n,
      idempotencyKey: "replace:a",
      requestedBy: "schedule",
    })
    expect(isReplacement(d?.action as Action)).toBe(true)
    expect(replacementsDue(e, { ...setting, percent: 50 }, price, now)[0]?.action.usdCents).toBe(
      250n,
    )
    // once attempted (even denied), the spend is settled for good
    for (const outcome of ["succeeded", "denied", "failed"] as const) {
      expect(
        replacementsDue(
          [...e, replacement("a", "2026-10-27T10:01:00Z", 500n, outcome)],
          setting,
          price,
          now,
        ),
      ).toEqual([])
    }
  })
  it("ignores failed spends, buys, sweeps and the replacements themselves; skips dust", () => {
    const buy: LedgerEntry = {
      id: "buy",
      at: "2026-10-27T09:00:00Z",
      action: {
        kind: "buy_bitcoin",
        exchange: "strike",
        usdCents: 1000n,
        estimatedSats: 10_000n,
        idempotencyKey: "b",
        requestedBy: "user",
      },
      decision: { type: "allow", summary: "" },
      outcome: "succeeded",
    }
    const sweep: LedgerEntry = {
      id: "sweep",
      at: "2026-10-27T09:30:00Z",
      action: {
        kind: "sweep_to_cold",
        address: "bc1q",
        keepSats: 0n,
        maxSats: 50_000n,
        idempotencyKey: "s",
        requestedBy: "user",
      },
      decision: { type: "allow", summary: "" },
      outcome: "succeeded",
    }
    const e = [
      buy,
      sweep,
      pay("failed", "2026-10-27T10:00:00Z", 5_000n, "failed"),
      pay("dust", "2026-10-27T10:05:00Z", 500n), // $0.50 < $1 minimum
      pay("ok", "2026-10-27T10:10:00Z", 2_000n),
      replacement("ok", "2026-10-27T10:11:00Z", 200n, "succeeded"),
    ]
    expect(replacementsDue(e, setting, price, now)).toEqual([])
  })
  it("stops at the rolling daily cap, oldest spend first, counting earlier replacements", () => {
    const s = { ...setting, dailyCapUsdCents: 10_00n }
    const e = [
      pay("old", "2026-10-26T13:00:00Z", 4_000n), // its replacement is inside the 24h window
      replacement("old", "2026-10-26T13:01:00Z", 400n, "succeeded"),
      pay("p1", "2026-10-27T10:00:00Z", 3_000n), // $3 → total $7
      pay("p2", "2026-10-27T10:30:00Z", 4_000n), // $4 → would be $11: stop
      pay("p3", "2026-10-27T11:00:00Z", 1_000n), // not reached; order is by time, not size
    ]
    expect(replacementsDue(e, s, price, now).map((d) => d.entry.id)).toEqual(["p1"])
    // a day later the window has moved on
    const later = new Date("2026-10-28T13:30:00Z")
    expect(replacementsDue(e, s, price, later).map((d) => d.entry.id)).toEqual(["p1", "p2", "p3"])
  })
})
