/**
 * Rewards (M13, ADR-0017): sats-back on purchases. A reward is a promise WE make, funded from our
 * own wallet, paid out through the same executor and policy as everything else. It is never a
 * balance the user holds with us: until it is paid it is our liability, listed as pending; once
 * paid it is a Lightning payment with a hash. Rates are operator configuration per source.
 */
import type { Sats } from "./money"

/** `referral` (M22): flat rewards for inviting a friend; `bps` is 0 and `orderId` is `ref:<id>:<side>`. */
export type RewardSource = "directory" | "bitrefill" | "referral"
export type RewardState = "pending" | "payable" | "paid" | "void"

export interface Reward {
  id: string
  /** Chat buyers: the user id, so a payout can mint an invoice on their paired wallet. */
  userId?: string
  /** Web buyers: the Lightning address they gave at checkout. */
  payoutAddress?: string
  source: RewardSource
  /** Merchant slug for directory purchases. */
  merchantSlug?: string
  orderId: string
  purchaseSats: Sats
  amountSats: Sats
  bps: number
  state: RewardState
  createdAt: string
  /** When it becomes payable (after the holding period, or on fulfilment). */
  payableAt: string
  paidAt?: string
  paymentHash?: string
  voidReason?: string
}

export interface RewardRates {
  /** Basis points of the purchase, per source. 100 = 1%. 0 disables. */
  bps: Record<RewardSource, number>
  /** Days before a reward on physical goods becomes payable (returns window). */
  holdDaysPhysical: number
  holdDaysDigital: number
  /** Smallest payout we make; smaller payable sums wait. */
  minPayoutSats: Sats
  /** A single purchase never earns more than this. */
  maxRewardSats: Sats
}

export const DEFAULT_REWARD_RATES: RewardRates = {
  bps: { directory: 100, bitrefill: 0, referral: 0 }, // referral rewards are flat (referrals.ts); Bitrefill stays 0 until OQ-16 (affiliate terms) is answered
  holdDaysPhysical: 14,
  holdDaysDigital: 1,
  minPayoutSats: 100n,
  maxRewardSats: 100_000n,
}

export interface RewardStore {
  readonly kind: string
  get(id: string): Promise<Reward | null>
  getByOrder(orderId: string): Promise<Reward | null>
  listForUser(userId: string): Promise<Reward[]>
  listForAddress(address: string): Promise<Reward[]>
  /** Rewards whose state is pending/payable, for the payout run. */
  listOpen(): Promise<Reward[]>
  create(r: Reward): Promise<void>
  update(r: Reward): Promise<void>
}

/** What the executor (chat) or the web checkout tells the reward sink after a purchase is paid. */
export interface Purchase {
  orderId: string
  source: RewardSource
  merchantSlug?: string
  purchaseSats: Sats
  kind: "digital" | "physical"
  userId?: string
  payoutAddress?: string
  at: string
}

export interface RewardSink {
  accrue(p: Purchase): Promise<Reward | null>
}

/** Pure: the reward a purchase earns under the rates, or null when nothing is owed. */
export function rewardFor(p: Purchase, rates: RewardRates, newId: () => string): Reward | null {
  const bps = rates.bps[p.source] ?? 0
  if (bps <= 0 || p.purchaseSats <= 0n) return null
  if (!p.userId && !p.payoutAddress) return null // nobody to pay
  let amount = (p.purchaseSats * BigInt(bps)) / 10_000n
  if (amount > rates.maxRewardSats) amount = rates.maxRewardSats
  if (amount < 1n) return null
  const holdDays = p.kind === "physical" ? rates.holdDaysPhysical : rates.holdDaysDigital
  const payableAt = new Date(new Date(p.at).getTime() + holdDays * 86_400_000).toISOString()
  return {
    id: newId(),
    userId: p.userId,
    payoutAddress: p.payoutAddress,
    source: p.source,
    merchantSlug: p.merchantSlug,
    orderId: p.orderId,
    purchaseSats: p.purchaseSats,
    amountSats: amount,
    bps,
    state: "pending",
    createdAt: p.at,
    payableAt,
  }
}

export interface RewardSummary {
  pendingSats: Sats
  payableSats: Sats
  paidSats: Sats
  count: number
  nextPayableAt?: string
}

export function summarizeRewards(rs: readonly Reward[], now: Date): RewardSummary {
  let pendingSats = 0n
  let payableSats = 0n
  let paidSats = 0n
  let next: string | undefined
  for (const r of rs) {
    if (r.state === "paid") paidSats += r.amountSats
    else if (r.state === "void") continue
    else if (r.state === "payable" || r.payableAt <= now.toISOString()) payableSats += r.amountSats
    else {
      pendingSats += r.amountSats
      if (!next || r.payableAt < next) next = r.payableAt
    }
  }
  return {
    pendingSats,
    payableSats,
    paidSats,
    count: rs.filter((r) => r.state !== "void").length,
    nextPayableAt: next,
  }
}

/** Group what is payable now by payee (user id or address), dropping sums under the minimum. */
export function payoutBatches(
  open: readonly Reward[],
  now: Date,
  minPayoutSats: Sats,
): { payee: { userId?: string; payoutAddress?: string }; rewards: Reward[]; totalSats: Sats }[] {
  const nowIso = now.toISOString()
  const by = new Map<string, Reward[]>()
  for (const r of open) {
    if (r.state === "paid" || r.state === "void") continue
    if (r.state !== "payable" && r.payableAt > nowIso) continue
    const k = r.userId ? `u:${r.userId}` : `a:${r.payoutAddress?.toLowerCase()}`
    by.set(k, [...(by.get(k) ?? []), r])
  }
  const out = []
  for (const rs of by.values()) {
    const totalSats = rs.reduce((a, r) => a + r.amountSats, 0n)
    if (totalSats < minPayoutSats) continue
    const first = rs[0] as Reward
    out.push({
      payee: { userId: first.userId, payoutAddress: first.payoutAddress },
      rewards: rs,
      totalSats,
    })
  }
  return out
}

export class InMemoryRewardStore implements RewardStore {
  readonly kind = "memory"
  readonly m = new Map<string, Reward>()
  async get(id: string) {
    return this.m.get(id) ?? null
  }
  async getByOrder(orderId: string) {
    return [...this.m.values()].find((r) => r.orderId === orderId) ?? null
  }
  async listForUser(userId: string) {
    return [...this.m.values()].filter((r) => r.userId === userId)
  }
  async listForAddress(address: string) {
    return [...this.m.values()].filter(
      (r) => r.payoutAddress?.toLowerCase() === address.toLowerCase(),
    )
  }
  async listOpen() {
    return [...this.m.values()].filter((r) => r.state === "pending" || r.state === "payable")
  }
  async create(r: Reward) {
    if ([...this.m.values()].some((x) => x.orderId === r.orderId)) return // one reward per order
    this.m.set(r.id, r)
  }
  async update(r: Reward) {
    this.m.set(r.id, r)
  }
}

/** A sink over a store and rates: idempotent per order. */
export function rewardSink(
  store: RewardStore,
  rates: RewardRates,
  newId: () => string,
): RewardSink {
  return {
    async accrue(p) {
      if (await store.getByOrder(p.orderId)) return null
      const r = rewardFor(p, rates, newId)
      if (!r) return null
      await store.create(r)
      return r
    },
  }
}
