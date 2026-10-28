import { describe, expect, it } from "vitest"
import type { Action } from "./action"
import type { LedgerEntry } from "./ledger"
import {
  DEFAULT_REFERRAL_RULES,
  InMemoryReferralStore,
  type Referral,
  type ReferralRules,
  hasSpent,
  joinWithCode,
  newReferralCode,
  normalizeCode,
  qualifyReferral,
  qualifyingSpend,
  referralLink,
  referralRewards,
  referralStats,
  referralsEnabled,
  referrerRewardsInMonth,
} from "./referrals"
import { InMemoryRewardStore } from "./rewards"

const RULES: ReferralRules = {
  referrerSats: 2_000n,
  friendSats: 500n,
  qualifyingSats: 1_000n,
  maxPerReferrerPerMonth: 2,
}

let seq = 0
const newId = () => `id_${++seq}`
const seqBytes = (bytes: number[]) => {
  let i = 0
  return () => bytes[i++ % bytes.length] as number
}

function entry(
  id: string,
  at: string,
  amountSats: bigint,
  outcome: LedgerEntry["outcome"] = "succeeded",
): LedgerEntry {
  const action: Action = {
    kind: "pay_address",
    address: "friend@example.com",
    amountSats,
    idempotencyKey: id,
    requestedBy: "user",
  }
  return {
    id,
    at,
    action,
    outcome,
    decision: { allow: true, summary: "s" },
  } as unknown as LedgerEntry
}

describe("referral codes", () => {
  it("draws six characters from the unambiguous alphabet, rejecting bytes that would skew it", () => {
    const code = newReferralCode(seqBytes([0, 255, 31, 224, 32, 100, 5, 200]))
    expect(code).toBe("A9AEFJ")
    expect(code).not.toMatch(/[01IO]/)
  })
  it("normalizes what people type and refuses what is not a code", () => {
    expect(normalizeCode(" ab-cd ef ")).toBe("ABCDEF")
    expect(normalizeCode("/join abcdef")).toBe("ABCDEF")
    expect(normalizeCode("code: ABCDEF")).toBe("ABCDEF")
    expect(normalizeCode("ABCDE")).toBeNull()
    expect(normalizeCode("ABCDEFG")).toBeNull()
    expect(normalizeCode("ABCD10")).toBeNull() // 1 and 0 are never in a code
    expect(normalizeCode("pay 500 sats")).toBeNull()
  })
  it("links to /join/<code> without a double slash", () => {
    expect(referralLink("https://anvard.ai/", "ABCDEF")).toBe("https://anvard.ai/join/ABCDEF")
    expect(referralLink(undefined, "ABCDEF")).toBe("/join/ABCDEF")
  })
  it("the store mints one stable code per user and never two users on one code", async () => {
    const store = new InMemoryReferralStore(seqBytes([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]))
    expect(await store.codeFor("a")).toBe("AAAAAA")
    expect(await store.codeFor("a")).toBe("AAAAAA")
    expect(await store.codeFor("b")).toBe("BBBBBB")
    expect(await store.userForCode("AAAAAA")).toBe("a")
    expect(await store.userForCode("ZZZZZZ")).toBeNull()
  })
})

describe("joining with a code", () => {
  const now = new Date("2026-10-28T12:00:00Z")
  it("links a friend once, before their first payment, never to themselves", async () => {
    const store = new InMemoryReferralStore()
    const code = await store.codeFor("alice")
    const r = await joinWithCode(store, RULES, {
      code: code.toLowerCase(),
      friendId: "bob",
      spent: false,
      now,
      newId,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error("expected ok")
    expect(r.referral).toMatchObject({ code, referrerId: "alice", friendId: "bob", rewardIds: [] })
    expect(await store.forFriend("bob")).toEqual(r.referral)
    expect((await store.listForReferrer("alice")).length).toBe(1)

    const again = await joinWithCode(store, RULES, {
      code,
      friendId: "bob",
      spent: false,
      now,
      newId,
    })
    expect(again).toEqual({ ok: false, code: "ALREADY_REFERRED" })
    expect(
      await joinWithCode(store, RULES, { code, friendId: "alice", spent: false, now, newId }),
    ).toEqual({ ok: false, code: "SELF" })
    expect(
      await joinWithCode(store, RULES, { code, friendId: "carol", spent: true, now, newId }),
    ).toEqual({ ok: false, code: "ALREADY_SPENT" })
    expect(
      await joinWithCode(store, RULES, {
        code: "NOPE",
        friendId: "carol",
        spent: false,
        now,
        newId,
      }),
    ).toEqual({ ok: false, code: "UNKNOWN_CODE" })
    expect(
      await joinWithCode(store, DEFAULT_REFERRAL_RULES, {
        code,
        friendId: "carol",
        spent: false,
        now,
        newId,
      }),
    ).toEqual({ ok: false, code: "DISABLED" })
  })
  it("the programme is on only when a side earns something", () => {
    expect(referralsEnabled(DEFAULT_REFERRAL_RULES)).toBe(false)
    expect(referralsEnabled({ referrerSats: 1n, friendSats: 0n })).toBe(true)
    expect(referralsEnabled({ referrerSats: 0n, friendSats: 1n })).toBe(true)
  })
})

describe("qualifying from the ledger", () => {
  it("finds the first succeeded spend at or over the minimum since joining; failed and small spends do not count", () => {
    const entries = [
      entry("e1", "2026-10-01T00:00:00Z", 5_000n), // before joining
      entry("e2", "2026-10-02T00:00:00Z", 500n), // too small
      entry("e3", "2026-10-03T00:00:00Z", 5_000n, "failed"),
      entry("e4", "2026-10-05T00:00:00Z", 1_000n),
      entry("e5", "2026-10-04T00:00:00Z", 2_000n), // earlier than e4 although listed later
    ]
    expect(hasSpent(entries)).toBe(true)
    expect(hasSpent([entry("x", "2026-10-01T00:00:00Z", 5n, "failed")])).toBe(false)
    expect(qualifyingSpend(entries, RULES, "2026-10-01T12:00:00Z")?.id).toBe("e5")
    expect(qualifyingSpend(entries.slice(0, 3), RULES, "2026-10-01T12:00:00Z")).toBeUndefined()
  })
  it("rewards are flat, payable at once, one per side, and the referrer stops at the monthly limit", () => {
    const ref: Referral = {
      id: "rf_1",
      code: "ABCDEF",
      referrerId: "alice",
      friendId: "bob",
      joinedAt: "2026-10-01T00:00:00Z",
      rewardIds: [],
    }
    const e = entry("e4", "2026-10-05T00:00:00Z", 1_500n)
    const both = referralRewards(ref, e, RULES, 0, newId)
    expect(both.referrerSkipped).toBeUndefined()
    expect(
      both.rewards.map((r) => [r.userId, r.amountSats, r.orderId, r.state, r.payableAt]),
    ).toEqual([
      ["alice", 2_000n, "ref:rf_1:referrer", "pending", e.at],
      ["bob", 500n, "ref:rf_1:friend", "pending", e.at],
    ])
    expect(
      both.rewards.every(
        (r) => r.source === "referral" && r.bps === 0 && r.purchaseSats === 1_500n,
      ),
    ).toBe(true)
    const capped = referralRewards(ref, e, RULES, 2, newId)
    expect(capped.referrerSkipped).toContain("monthly limit of 2")
    expect(capped.rewards.map((r) => r.userId)).toEqual(["bob"])
    const noFriend = referralRewards(ref, e, { ...RULES, friendSats: 0n }, 0, newId)
    expect(noFriend.rewards.map((r) => r.userId)).toEqual(["alice"])
  })
  it("counts the referrer's paid referrals in a month", () => {
    const base: Referral = {
      id: "x",
      code: "C",
      referrerId: "a",
      friendId: "f",
      joinedAt: "",
      rewardIds: [],
    }
    const rs: Referral[] = [
      { ...base, qualifiedAt: "2026-10-02T00:00:00Z" },
      { ...base, qualifiedAt: "2026-10-20T00:00:00Z", referrerSkipped: "cap" },
      { ...base, qualifiedAt: "2026-09-30T23:59:59Z" },
      { ...base },
    ]
    expect(referrerRewardsInMonth(rs, "2026-10-28T00:00:00Z")).toBe(1)
    expect(referrerRewardsInMonth(rs, "2026-09-01T00:00:00Z")).toBe(1)
  })
  it("qualifyReferral records both rewards once and is idempotent; stats show the referrer's side", async () => {
    const referrals = new InMemoryReferralStore(seqBytes([2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]))
    const rewards = new InMemoryRewardStore()
    const code = await referrals.codeFor("alice")
    const joined = await joinWithCode(referrals, RULES, {
      code,
      friendId: "bob",
      spent: false,
      now: new Date("2026-10-01T00:00:00Z"),
      newId,
    })
    expect(joined.ok).toBe(true)
    const deps = { referrals, rewards, rules: RULES, newRewardId: newId }
    expect(
      await qualifyReferral(deps, "bob", [entry("e1", "2026-10-02T00:00:00Z", 100n)]),
    ).toBeNull()
    expect(
      await qualifyReferral(deps, "nobody", [entry("e1", "2026-10-02T00:00:00Z", 9_000n)]),
    ).toBeNull()
    const entries = [
      entry("e1", "2026-10-02T00:00:00Z", 100n),
      entry("e2", "2026-10-03T00:00:00Z", 1_000n),
    ]
    const q = await qualifyReferral(deps, "bob", entries)
    expect(q?.referral.qualifiedAt).toBe("2026-10-03T00:00:00Z")
    expect(q?.referral.qualifyingEntryId).toBe("e2")
    expect(q?.rewards.length).toBe(2)
    expect(await qualifyReferral(deps, "bob", entries)).toBeNull()
    expect((await rewards.listForUser("alice")).map((r) => r.amountSats)).toEqual([2_000n])
    expect((await rewards.listForUser("bob")).map((r) => r.amountSats)).toEqual([500n])
    const stats = await referralStats(referrals, rewards, RULES, "alice", "https://anvard.ai")
    expect(stats).toMatchObject({
      code: "CCCCCC",
      link: "https://anvard.ai/join/CCCCCC",
      joined: 1,
      qualified: 1,
      earnedSats: 2_000n,
    })
    expect(stats.referredBy).toBeUndefined()
    const bobStats = await referralStats(referrals, rewards, RULES, "bob", undefined)
    expect(bobStats.referredBy).toEqual({ qualified: true, qualifyingSats: 1_000n })
    expect(bobStats.earnedSats).toBe(0n) // the friend-side reward is not "earned by referring"
  })
})
