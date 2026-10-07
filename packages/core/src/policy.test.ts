import { ACTIONS, POLICIES, PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import type { Action } from "./action"
import { DEFAULT_POLICY, type Policy, evaluate, matches, summarize, windowStart } from "./policy"

const open: Policy = POLICIES.open
const strict: Policy = POLICIES.strict
const none = { spentSats: 0n }

describe("evaluate: gates in order", () => {
  it("kill switch denies everything, even reads", () => {
    expect(evaluate(ACTIONS.balance, POLICIES.killed, none)).toMatchObject({
      type: "deny",
      reason: "KILL_SWITCH",
    })
    expect(evaluate(ACTIONS.tip, POLICIES.killed, none)).toMatchObject({
      type: "deny",
      reason: "KILL_SWITCH",
    })
  })
  it("a disabled rail denies its actions and nothing else", () => {
    const p: Policy = { ...open, rails: { ...open.rails, exchange: false } }
    expect(evaluate(ACTIONS.dca, p, none)).toMatchObject({ type: "deny", reason: "RAIL_DISABLED" })
    expect(evaluate(ACTIONS.schedule, p, none)).toMatchObject({
      type: "deny",
      reason: "RAIL_DISABLED",
    })
    expect(evaluate(ACTIONS.tip, p, none).type).toBe("allow")
  })
  it("reads and receives are allowed regardless of caps or lists", () => {
    const p: Policy = {
      ...strict,
      dailyCapSats: 0n,
      perActionCapSats: 0n,
      allowDestinations: ["nobody"],
    }
    expect(evaluate(ACTIONS.balance, p, { spentSats: 10n })).toMatchObject({ type: "allow" })
    expect(evaluate(ACTIONS.invoice, p, { spentSats: 10n })).toMatchObject({ type: "allow" })
    expect(evaluate(ACTIONS.cancel, p, { spentSats: 10n })).toMatchObject({ type: "allow" })
  })
  it("a spend without an idempotency key is denied", () => {
    expect(evaluate({ ...ACTIONS.tip, idempotencyKey: "  " }, open, none)).toMatchObject({
      type: "deny",
      reason: "MISSING_IDEMPOTENCY_KEY",
    })
  })
  it("deny list wins over allow list", () => {
    const p: Policy = {
      ...open,
      allowDestinations: ["*@evil.example"],
      denyDestinations: ["*@evil.example"],
    }
    expect(evaluate(ACTIONS.payScammer, p, none)).toMatchObject({
      type: "deny",
      reason: "DESTINATION_DENIED",
    })
  })
  it("allow list: only listed destinations may receive", () => {
    expect(evaluate(ACTIONS.tip, strict, none).type).toBe("allow")
    expect(evaluate(ACTIONS.payFriend, strict, none)).toMatchObject({
      type: "deny",
      reason: "DESTINATION_NOT_ALLOWED",
    })
    expect(evaluate(ACTIONS.compute, strict, none).type).toBe("allow")
    const smallDca = { ...ACTIONS.dca, usdCents: 5_00n, estimatedSats: 6_010n }
    expect(evaluate(smallDca, strict, none).type).toBe("needs_confirmation") // strike allowed, ≥ 5k threshold
    expect(evaluate(ACTIONS.dca, strict, none)).toMatchObject({
      type: "deny",
      reason: "PER_ACTION_CAP",
    })
  })
  it("empty allow list means any destination not denied", () => {
    expect(evaluate(ACTIONS.payFriend, open, none).type).toBe("allow")
  })
  it("per-action cap", () => {
    const p: Policy = { ...open, perActionCapSats: 20n }
    expect(evaluate(ACTIONS.tip, p, none)).toMatchObject({ type: "deny", reason: "PER_ACTION_CAP" })
    expect(evaluate({ ...ACTIONS.tip, amountSats: 20n }, p, none).type).toBe("allow")
  })
  it("daily cap counts what the window already spent", () => {
    const p: Policy = { ...open, dailyCapSats: 100n }
    expect(evaluate(ACTIONS.tip, p, { spentSats: 79n }).type).toBe("allow") // 79 + 21 = 100, at cap
    expect(evaluate(ACTIONS.tip, p, { spentSats: 80n })).toMatchObject({
      type: "deny",
      reason: "DAILY_CAP",
    })
  })
  it("cap exhaustion: the per-action cap is checked before the daily cap", () => {
    const p: Policy = { ...open, perActionCapSats: 10n, dailyCapSats: 10n }
    expect(evaluate(ACTIONS.tip, p, { spentSats: 1_000n })).toMatchObject({
      reason: "PER_ACTION_CAP",
    })
  })
  it("confirm threshold: at or above needs a human", () => {
    const p: Policy = { ...open, confirmAboveSats: 21n }
    expect(evaluate(ACTIONS.tip, p, none).type).toBe("needs_confirmation")
    expect(evaluate({ ...ACTIONS.tip, amountSats: 20n }, p, none).type).toBe("allow")
  })
  it("confirmAboveSats = 0 confirms every spend", () => {
    const p: Policy = { ...open, confirmAboveSats: 0n }
    expect(evaluate({ ...ACTIONS.tip, amountSats: 1n }, p, none).type).toBe("needs_confirmation")
  })
  it("buying a product always needs confirmation, even below the threshold", () => {
    const d = evaluate(ACTIONS.giftCard, open, none)
    expect(d.type).toBe("needs_confirmation")
    if (d.type === "needs_confirmation") expect(d.actionHash).toMatch(/^[0-9a-f]{64}$/)
  })
  it("the default policy is conservative: exchange off, goods confirmed, 10k threshold", () => {
    expect(DEFAULT_POLICY.rails.exchange).toBe(false)
    expect(evaluate(ACTIONS.payFriend, DEFAULT_POLICY, none).type).toBe("needs_confirmation") // 15k ≥ 10k
    expect(evaluate(ACTIONS.tip, DEFAULT_POLICY, none).type).toBe("allow")
  })
})

describe("summaries carry sats and fiat", () => {
  it("with a price snapshot", () => {
    const d = evaluate(ACTIONS.payFriend, open, none, { price: PRICE })
    expect(d.summary).toBe("Pay friend@walletofsatoshi.com · 15,000 sats (≈ $12.47 at $83,169/BTC)")
  })
  it("without a price, sats only", () => {
    expect(summarize(ACTIONS.tip, 21n)).toBe('Pay gm@getalby.com ("thanks") · 21 sats')
  })
  it("reads have no amount", () => {
    expect(summarize(ACTIONS.balance, 0n, PRICE)).toBe("Check the wallet balance")
  })
})

describe("destination patterns", () => {
  it.each([
    ["gm@getalby.com", "GM@GetAlby.com", true],
    ["*@getalby.com", "anyone@getalby.com", true],
    ["*@getalby.com", "anyone@notgetalby.com", false],
    ["*.evil.example", "free-money@evil.example", false], // an address is not a host
    ["*.evil.example", "evil.example", true],
    ["*.evil.example", "api.evil.example", true],
    ["*.evil.example", "notevil.example", false],
    ["llm402.ai", "llm402.ai", true],
    ["", "x", false],
  ])("%s vs %s → %s", (pattern, dest, expected) => {
    expect(matches(pattern, dest)).toBe(expected)
  })
  it("deny-listing an address domain blocks the fixture scammer", () => {
    const p: Policy = { ...open, denyDestinations: ["*@evil.example"] }
    expect(evaluate(ACTIONS.payScammer, p, none)).toMatchObject({ reason: "DESTINATION_DENIED" })
  })
})

describe("window", () => {
  it("starts 24h before now", () => {
    expect(windowStart(new Date("2026-10-07T12:00:00.000Z"))).toBe("2026-10-06T12:00:00.000Z")
  })
})

describe("type exhaustiveness", () => {
  it("every fixture action evaluates to a decision", () => {
    for (const a of Object.values(ACTIONS) as Action[]) {
      expect(["allow", "needs_confirmation", "deny"]).toContain(evaluate(a, open, none).type)
    }
  })
})
