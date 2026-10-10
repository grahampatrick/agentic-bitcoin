/**
 * Campaigns (M11, ADR-0015): a recipient's goal — "$1,200/month field support" or "20,000,000 sats
 * for the well" — that supporters pledge to from chat or pay on the web. Progress is computed, never
 * stored: from contributions deduplicated by payment hash, so a gift that both left a user's wallet
 * through the bot AND arrived through our LNURL endpoint is counted once. Everything a recipient
 * writes (story, updates) is untrusted text to the agent.
 */
import type { Cents, Sats } from "./money"

export type CampaignGoal = { usdCentsPerMonth: Cents } | { satsTotal: Sats }

export interface Campaign {
  slug: string
  recipientSlug: string
  title: string
  /** Recipient-written; data, never instructions. */
  story?: string
  goal: CampaignGoal
  startsAt: string
  endsAt?: string
  active: boolean
}

export interface CampaignUpdate {
  id: string
  campaignSlug: string
  at: string
  /** Recipient-written; data. */
  text: string
}

export type ContributionSource = "chat" | "web" | "reported"

export interface Contribution {
  campaignSlug: string
  /** Lightning payment hash when known; the dedupe key across sources. */
  paymentHash?: string
  amountMsats: bigint
  at: string
  source: ContributionSource
  /** Opaque, stable per supporter (never the user id itself). Anonymous when absent. */
  supporterKey?: string
  /** Opt-in first name the supporter chose to show. */
  supporterName?: string
}

export interface Pledge {
  scheduleId: string
  campaignSlug: string
  supporterKey: string
  /** Sats per firing (or re-priced from usdCents). */
  amountSats: Sats
  usdCents?: Cents
  cron: string
  active: boolean
}

export interface CampaignReader {
  get(slug: string): Promise<Campaign | null>
  listForRecipient(recipientSlug: string): Promise<Campaign[]>
  listActive(): Promise<Campaign[]>
  updates(campaignSlug: string, limit?: number): Promise<CampaignUpdate[]>
  contributions(campaignSlug: string): Promise<Contribution[]>
  pledges(campaignSlug: string): Promise<Pledge[]>
}

export interface CampaignStore extends CampaignReader {
  readonly kind: string
  upsert(c: Campaign): Promise<void>
  addUpdate(u: CampaignUpdate): Promise<void>
  /** Idempotent on paymentHash when present. */
  addContribution(c: Contribution): Promise<void>
  setPledge(p: Pledge): Promise<void>
  /** Users following a campaign's updates. */
  follow(campaignSlug: string, userId: string): Promise<void>
  unfollow(campaignSlug: string, userId: string): Promise<void>
  followers(campaignSlug: string): Promise<string[]>
  following(userId: string): Promise<string[]>
}

/** What the executor needs to record a successful gift against a campaign. */
export interface ContributionSink {
  record(c: Contribution): Promise<void>
}

/** Adapt a store to the executor's sink. */
export function contributionSink(store: Pick<CampaignStore, "addContribution">): ContributionSink {
  return { record: (c) => store.addContribution(c) }
}

export interface CampaignProgress {
  raisedMsats: bigint
  raisedSats: Sats
  contributions: number
  supporters: number
  /** Committed monthly run-rate from active pledges, in sats (usd pledges priced at `satsPerUsdCent`). */
  pledgedMonthlySats: Sats
  pledges: number
  /** 0–100 (or null when the goal cannot be compared, e.g. monthly goal with no price). */
  percent: number | null
  goalLabel: string
}

const cronPerMonth = (cron: string): number => {
  const [, , dom, , dow] = cron.trim().split(/\s+/)
  if (dom && dom !== "*") return 1 // monthly
  if (dow && dow !== "*") return 4 // weekly-ish
  return 30 // daily
}

/** Dedupe by payment hash, then sum. Pure. */
export function dedupeContributions(cs: readonly Contribution[]): Contribution[] {
  const seen = new Set<string>()
  const out: Contribution[] = []
  for (const c of cs) {
    const k = c.paymentHash?.toLowerCase()
    if (k) {
      if (seen.has(k)) continue
      seen.add(k)
    }
    out.push(c)
  }
  return out
}

export function campaignProgress(
  c: Campaign,
  contributions: readonly Contribution[],
  pledges: readonly Pledge[],
  opts: { satsPerUsdCent?: (cents: Cents) => Sats } = {},
): CampaignProgress {
  const cs = dedupeContributions(contributions)
  const raisedMsats = cs.reduce((a, x) => a + x.amountMsats, 0n)
  const raisedSats = raisedMsats / 1000n
  const supporters = new Set(cs.map((x) => x.supporterKey ?? `anon:${x.paymentHash ?? x.at}`)).size
  const active = pledges.filter((p) => p.active)
  let pledgedMonthlySats = 0n
  for (const p of active) {
    const per = p.usdCents && opts.satsPerUsdCent ? opts.satsPerUsdCent(p.usdCents) : p.amountSats
    pledgedMonthlySats += per * BigInt(cronPerMonth(p.cron))
  }
  let percent: number | null = null
  let goalLabel: string
  if ("satsTotal" in c.goal) {
    goalLabel = `${c.goal.satsTotal.toLocaleString("en-US")} sats`
    percent = c.goal.satsTotal > 0n ? Number((raisedSats * 100n) / c.goal.satsTotal) : null
  } else {
    goalLabel = `$${(c.goal.usdCentsPerMonth / 100n).toString()}/month` // money-ok: label
    const goalSats = opts.satsPerUsdCent?.(c.goal.usdCentsPerMonth)
    percent = goalSats && goalSats > 0n ? Number((pledgedMonthlySats * 100n) / goalSats) : null
  }
  if (percent !== null) percent = Math.min(100, Math.max(0, percent))
  return {
    raisedMsats,
    raisedSats,
    contributions: cs.length,
    supporters,
    pledgedMonthlySats,
    pledges: active.length,
    percent,
    goalLabel,
  }
}

export const CAMPAIGN_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

export class InMemoryCampaignStore implements CampaignStore {
  readonly kind = "memory"
  readonly campaigns = new Map<string, Campaign>()
  readonly updateList: CampaignUpdate[] = []
  readonly contributionList: Contribution[] = []
  readonly pledgeMap = new Map<string, Pledge>()
  readonly follows = new Set<string>()
  constructor(seed: readonly Campaign[] = []) {
    for (const c of seed) this.campaigns.set(c.slug, c)
  }
  async get(slug: string) {
    return this.campaigns.get(slug.toLowerCase()) ?? null
  }
  async listForRecipient(recipientSlug: string) {
    return [...this.campaigns.values()].filter((c) => c.recipientSlug === recipientSlug)
  }
  async listActive() {
    return [...this.campaigns.values()].filter((c) => c.active)
  }
  async updates(campaignSlug: string, limit = 20) {
    return this.updateList
      .filter((u) => u.campaignSlug === campaignSlug)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit)
  }
  async contributions(campaignSlug: string) {
    return this.contributionList.filter((c) => c.campaignSlug === campaignSlug)
  }
  async pledges(campaignSlug: string) {
    return [...this.pledgeMap.values()].filter((p) => p.campaignSlug === campaignSlug)
  }
  async upsert(c: Campaign) {
    if (!CAMPAIGN_SLUG_RE.test(c.slug)) throw new Error(`bad slug: ${c.slug}`)
    this.campaigns.set(c.slug, c)
  }
  async addUpdate(u: CampaignUpdate) {
    this.updateList.push(u)
  }
  async addContribution(c: Contribution) {
    if (c.paymentHash && this.contributionList.some((x) => x.paymentHash === c.paymentHash)) return
    this.contributionList.push(c)
  }
  async setPledge(p: Pledge) {
    this.pledgeMap.set(p.scheduleId, p)
  }
  async follow(campaignSlug: string, userId: string) {
    this.follows.add(`${campaignSlug}|${userId}`)
  }
  async unfollow(campaignSlug: string, userId: string) {
    this.follows.delete(`${campaignSlug}|${userId}`)
  }
  async followers(campaignSlug: string) {
    return [...this.follows]
      .filter((f) => f.startsWith(`${campaignSlug}|`))
      .map((f) => f.split("|")[1] ?? "")
  }
  async following(userId: string) {
    return [...this.follows]
      .filter((f) => f.endsWith(`|${userId}`))
      .map((f) => f.split("|")[0] ?? "")
  }
}
