/**
 * Referral rewards in sats (M22, ADR-0025). A user has one invite code. A friend who joins with it
 * is linked to them once, before the friend's first payment. When the friend's first payment of at
 * least `qualifyingSats` succeeds, two flat rewards are recorded: one for the referrer, one for the
 * friend. They are ordinary rewards (M13, ADR-0017): a promise from the operator, paid from the
 * operator's own wallet by the same payout run as sats-back, to each person's own paired wallet.
 * Nothing here moves money; the qualifying payment is read from the ledger, never counted.
 */
import { spendSats } from "./action"
import type { LedgerEntry } from "./ledger"
import type { Sats } from "./money"
import type { Reward, RewardStore } from "./rewards"

export interface ReferralRules {
  /** Flat sats the referrer earns per qualified friend. 0 = the referrer earns nothing. */
  referrerSats: Sats
  /** Flat sats the friend earns on their first qualifying payment. 0 = nothing. */
  friendSats: Sats
  /** The friend's first payment must move at least this many sats to count. */
  qualifyingSats: Sats
  /** Referrer rewards per UTC month; friends beyond it still qualify, the referrer is not paid. */
  maxPerReferrerPerMonth: number
}

export const DEFAULT_REFERRAL_RULES: ReferralRules = {
  referrerSats: 0n,
  friendSats: 0n,
  qualifyingSats: 1000n,
  maxPerReferrerPerMonth: 10,
}

/** The programme is on when at least one side earns something. */
export function referralsEnabled(
  rules: Pick<ReferralRules, "referrerSats" | "friendSats">,
): boolean {
  return rules.referrerSats > 0n || rules.friendSats > 0n
}

export interface Referral {
  /** `rf_…` */
  id: string
  code: string
  referrerId: string
  friendId: string
  joinedAt: string
  /** Set once the friend's first qualifying payment succeeded. */
  qualifiedAt?: string
  qualifyingEntryId?: string
  qualifyingSats?: Sats
  /** The reward ids this referral created (0–2). */
  rewardIds: string[]
  /** Why the referrer got nothing although the friend qualified (monthly cap). */
  referrerSkipped?: string
}

export interface ReferralStore {
  readonly kind: string
  /** The user's invite code, minted on first ask and stable after. */
  codeFor(userId: string): Promise<string>
  userForCode(code: string): Promise<string | null>
  /** The one referral a friend can have. */
  forFriend(friendId: string): Promise<Referral | null>
  listForReferrer(referrerId: string): Promise<Referral[]>
  /** Ignored when the friend already has a referral (one per friend, first wins). */
  create(r: Referral): Promise<void>
  update(r: Referral): Promise<void>
}

/** No 0/O/1/I: a code is read aloud and typed on a phone. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const CODE_LENGTH = 6
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/

export function newReferralCode(randomByte: () => number): string {
  let out = ""
  while (out.length < CODE_LENGTH) {
    const b = randomByte() & 0xff
    if (b >= 224) continue // 224 = 7 × 32: rejection keeps the draw uniform
    out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  }
  return out
}

/** "join ab-cd ef" → "ABCDEF"; null when it is not a code. Only letters and digits count. */
export function normalizeCode(text: string): string | null {
  const t = text
    .trim()
    .replace(/^(\/join|join|code|invite|ref)\b[:\s]*/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
  return CODE_RE.test(t) ? t : null
}

export function referralLink(siteUrl: string | undefined, code: string): string {
  return `${(siteUrl ?? "").replace(/\/$/, "")}/join/${code}`
}

/** Has this user ever moved sats out? A friend's code counts only before that. */
export function hasSpent(entries: readonly LedgerEntry[]): boolean {
  return entries.some((e) => e.outcome === "succeeded" && spendSats(e.action) > 0n)
}

export type JoinResult =
  | { ok: true; referral: Referral }
  | {
      ok: false
      code: "DISABLED" | "UNKNOWN_CODE" | "SELF" | "ALREADY_REFERRED" | "ALREADY_SPENT"
    }

export interface JoinInput {
  code: string
  friendId: string
  /** True when the friend has already made a payment through the bot. */
  spent: boolean
  now: Date
  newId: () => string
}

/** Links a friend to the owner of `code`, once, before the friend's first payment. */
export async function joinWithCode(
  store: ReferralStore,
  rules: ReferralRules,
  input: JoinInput,
): Promise<JoinResult> {
  if (!referralsEnabled(rules)) return { ok: false, code: "DISABLED" }
  const code = normalizeCode(input.code)
  const referrerId = code ? await store.userForCode(code) : null
  if (!code || !referrerId) return { ok: false, code: "UNKNOWN_CODE" }
  if (referrerId === input.friendId) return { ok: false, code: "SELF" }
  if (await store.forFriend(input.friendId)) return { ok: false, code: "ALREADY_REFERRED" }
  if (input.spent) return { ok: false, code: "ALREADY_SPENT" }
  const referral: Referral = {
    id: input.newId(),
    code,
    referrerId,
    friendId: input.friendId,
    joinedAt: input.now.toISOString(),
    rewardIds: [],
  }
  await store.create(referral)
  return { ok: true, referral }
}

/** The friend's first succeeded spend of at least `qualifyingSats` at or after they joined. */
export function qualifyingSpend(
  entries: readonly LedgerEntry[],
  rules: Pick<ReferralRules, "qualifyingSats">,
  joinedAt: string,
): LedgerEntry | undefined {
  return [...entries]
    .filter(
      (e) =>
        e.outcome === "succeeded" &&
        e.at >= joinedAt &&
        spendSats(e.action) >= rules.qualifyingSats,
    )
    .sort((a, b) => a.at.localeCompare(b.at))[0]
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/** Referrer rewards already earned in the month of `at` (qualified referrals that paid the referrer). */
export function referrerRewardsInMonth(referrals: readonly Referral[], at: string): number {
  const m = monthKey(at)
  return referrals.filter(
    (r) => r.qualifiedAt && monthKey(r.qualifiedAt) === m && !r.referrerSkipped,
  ).length
}

/**
 * Pure: the rewards a qualifying payment earns. Flat amounts, payable at once (a Lightning payment
 * is final, there is no returns window), one reward per side keyed `ref:<id>:<side>`.
 */
export function referralRewards(
  referral: Referral,
  entry: LedgerEntry,
  rules: ReferralRules,
  referrerRewardsThisMonth: number,
  newId: () => string,
): { rewards: Reward[]; referrerSkipped?: string } {
  const at = entry.at
  const purchaseSats = spendSats(entry.action)
  const base = (side: "referrer" | "friend", userId: string, amountSats: Sats): Reward => ({
    id: newId(),
    userId,
    source: "referral",
    orderId: `ref:${referral.id}:${side}`,
    purchaseSats,
    amountSats,
    bps: 0,
    state: "pending",
    createdAt: at,
    payableAt: at,
  })
  const rewards: Reward[] = []
  let referrerSkipped: string | undefined
  if (rules.referrerSats > 0n) {
    if (referrerRewardsThisMonth >= rules.maxPerReferrerPerMonth)
      referrerSkipped = `monthly limit of ${rules.maxPerReferrerPerMonth} reached`
    else rewards.push(base("referrer", referral.referrerId, rules.referrerSats))
  }
  if (rules.friendSats > 0n) rewards.push(base("friend", referral.friendId, rules.friendSats))
  return { rewards, referrerSkipped }
}

export interface QualifyDeps {
  referrals: ReferralStore
  rewards: RewardStore
  rules: ReferralRules
  newRewardId: () => string
}

/**
 * After a spend by `friendId`: if they were referred and not yet qualified, and the ledger now holds
 * a qualifying payment, record the rewards. Idempotent: a second call finds the referral qualified.
 */
export async function qualifyReferral(
  deps: QualifyDeps,
  friendId: string,
  entries: readonly LedgerEntry[],
): Promise<{ referral: Referral; rewards: Reward[] } | null> {
  if (!referralsEnabled(deps.rules)) return null
  const referral = await deps.referrals.forFriend(friendId)
  if (!referral || referral.qualifiedAt) return null
  const entry = qualifyingSpend(entries, deps.rules, referral.joinedAt)
  if (!entry) return null
  const earned = referrerRewardsInMonth(
    await deps.referrals.listForReferrer(referral.referrerId),
    entry.at,
  )
  const { rewards, referrerSkipped } = referralRewards(
    referral,
    entry,
    deps.rules,
    earned,
    deps.newRewardId,
  )
  for (const r of rewards) await deps.rewards.create(r)
  const qualified: Referral = {
    ...referral,
    qualifiedAt: entry.at,
    qualifyingEntryId: entry.id,
    qualifyingSats: spendSats(entry.action),
    rewardIds: rewards.map((r) => r.id),
    referrerSkipped,
  }
  await deps.referrals.update(qualified)
  return { referral: qualified, rewards }
}

export interface ReferralStats {
  code: string
  link: string
  /** Friends who joined with the code. */
  joined: number
  /** Friends whose first payment qualified. */
  qualified: number
  /** Referrer rewards recorded (pending + payable + paid), in sats. */
  earnedSats: Sats
  /** Set when this user was referred by someone: have they qualified yet? */
  referredBy?: { qualified: boolean; qualifyingSats: Sats }
  rules: ReferralRules
}

/** What `/refer` and the `referral_info` tool show. */
export async function referralStats(
  referrals: ReferralStore,
  rewards: RewardStore,
  rules: ReferralRules,
  userId: string,
  siteUrl: string | undefined,
): Promise<ReferralStats> {
  const code = await referrals.codeFor(userId)
  const mine = await referrals.listForReferrer(userId)
  const earnedSats = (await rewards.listForUser(userId))
    .filter((r) => r.source === "referral" && r.orderId.endsWith(":referrer") && r.state !== "void")
    .reduce((a, r) => a + r.amountSats, 0n)
  const asFriend = await referrals.forFriend(userId)
  return {
    code,
    link: referralLink(siteUrl, code),
    joined: mine.length,
    qualified: mine.filter((r) => r.qualifiedAt).length,
    earnedSats,
    referredBy: asFriend
      ? { qualified: Boolean(asFriend.qualifiedAt), qualifyingSats: rules.qualifyingSats }
      : undefined,
    rules,
  }
}

export class InMemoryReferralStore implements ReferralStore {
  readonly kind = "memory"
  readonly codes = new Map<string, string>() // code → userId
  readonly byUser = new Map<string, string>() // userId → code
  readonly referrals = new Map<string, Referral>() // friendId → referral
  constructor(private readonly randomByte: () => number = () => Math.floor(Math.random() * 256)) {} // money-ok: a code draw, not money
  async codeFor(userId: string) {
    const have = this.byUser.get(userId)
    if (have) return have
    let code = newReferralCode(this.randomByte)
    for (let tries = 0; this.codes.has(code); tries++) {
      if (tries >= 20) throw new Error("could not mint an unused referral code")
      code = newReferralCode(this.randomByte)
    }
    this.codes.set(code, userId)
    this.byUser.set(userId, code)
    return code
  }
  async userForCode(code: string) {
    return this.codes.get(code) ?? null
  }
  async forFriend(friendId: string) {
    return this.referrals.get(friendId) ?? null
  }
  async listForReferrer(referrerId: string) {
    return [...this.referrals.values()].filter((r) => r.referrerId === referrerId)
  }
  async create(r: Referral) {
    if (this.referrals.has(r.friendId)) return
    this.referrals.set(r.friendId, r)
  }
  async update(r: Referral) {
    this.referrals.set(r.friendId, r)
  }
}
