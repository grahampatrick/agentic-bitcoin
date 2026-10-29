/**
 * The workspace (M23, ADR-0027): what a user sees at /me and the few things they may change there.
 * Everything is a view over stores the bot already writes. The token comes from `/web` in chat;
 * only its hash is stored. Secrets are never read here, only "is one set?".
 */
import { getCardStore } from "@/lib/cards/store"
import { chatLinks } from "@/lib/onboarding-links"
import { siteBaseUrl } from "@/lib/receive/service"
import {
  DEFAULT_POLICY,
  DEFAULT_REFERRAL_RULES,
  type Policy,
  type PolicyPatch,
  type ReferralRules,
  type VirtualCard,
  describeIdentity,
  hashWebToken,
  patchPolicy,
  periodEnd,
  referralStats,
  referralsEnabled,
  referrerRewardsInMonth,
  summarizeRewards,
} from "@agentic-bitcoin/core"
import { DEMO_USER, type MeStores, meStoresReady } from "./store"

export function referralRulesFromEnv(env = process.env): ReferralRules {
  return {
    referrerSats: BigInt(env.REFERRAL_REWARD_SATS ?? "0"),
    friendSats: BigInt(env.REFERRAL_FRIEND_SATS ?? "0"),
    qualifyingSats: BigInt(env.REFERRAL_MIN_SPEND_SATS ?? DEFAULT_REFERRAL_RULES.qualifyingSats),
    maxPerReferrerPerMonth: Number(
      env.REFERRAL_MAX_PER_MONTH ?? DEFAULT_REFERRAL_RULES.maxPerReferrerPerMonth,
    ),
  }
}

export interface WorkspaceCard {
  id: string
  name: string
  state: VirtualCard["state"]
  scope: readonly string[]
  monthlyCapSats: string
  spentSats: string
  resetsAt: string
}

export interface Workspace {
  token: string
  userId: string
  demo: boolean
  identity: { surface: string; masked: string }
  policy: Policy
  wallet: { connected: boolean }
  keys: { strike: boolean; bitrefill: boolean }
  address: { name: string; host: string; forwardTo?: string } | null
  cards: WorkspaceCard[]
  invites: {
    on: boolean
    code: string
    link: string
    joined: number
    qualified: number
    earnedSats: string
    usedThisMonth: number
    maxPerMonth: number
    referrerSats: string
    friendSats: string
    qualifyingSats: string
    friends: { masked: string; joinedAt: string; qualified: boolean }[]
  }
  rewards: { pendingSats: string; payableSats: string; paidSats: string }
  /** Active web links for this user, this one included. */
  links: number
  contact: { signal?: { number: string; url: string }; discord?: string; email?: string }
}

async function userForToken(s: MeStores, token: string | undefined, now: Date) {
  if (!token || token.length > 200) return null
  return s.webLinks.userFor(hashWebToken(token), now)
}

/** The whole workspace, or null when the token is unknown or expired. */
export async function workspaceFor(
  token: string | undefined,
  now = new Date(),
  env = process.env,
): Promise<Workspace | null> {
  const s = await meStoresReady()
  const userId = await userForToken(s, token, now)
  if (!userId || !token) return null
  const cards = getCardStore()
  const envRules = referralRulesFromEnv(env)
  // the keyless demo shows the whole shape even when the operator has not set REFERRAL_* yet
  const rules =
    s.demo && !referralsEnabled(envRules)
      ? { ...envRules, referrerSats: 1_000n, friendSats: 500n }
      : envRules
  const base = siteBaseUrl()
  const [policy, nwc, strike, bitrefill, address, cardList, links, rewardList, stats, mine] =
    await Promise.all([
      s.policies.get(userId),
      s.secrets.get(userId, "nwc"),
      s.secrets.get(userId, "strike"),
      s.secrets.get(userId, "bitrefill"),
      s.addresses.getForUser(userId),
      cards.listForUser(userId),
      s.webLinks.listForUser(userId),
      s.rewards.listForUser(userId),
      referralStats(s.referrals, s.rewards, rules, userId, base),
      s.referrals.listForReferrer(userId),
    ])
  const sum = summarizeRewards(rewardList, now)
  const identity =
    userId === DEMO_USER
      ? { surface: "Demo", masked: "a fictional account" }
      : describeIdentity(userId)
  return {
    token,
    userId,
    demo: s.demo,
    identity,
    policy: policy ?? DEFAULT_POLICY,
    wallet: { connected: !!nwc },
    keys: { strike: !!strike, bitrefill: !!bitrefill },
    address: address
      ? { name: address.name, host: new URL(base).host, forwardTo: address.forwardTo }
      : null,
    cards: cardList
      .filter((c) => c.state !== "closed")
      .map((c) => ({
        id: c.id,
        name: c.name,
        state: c.state,
        scope: c.scope,
        monthlyCapSats: c.monthlyCapSats.toString(),
        spentSats: (c.spentSats ?? 0n).toString(),
        resetsAt: periodEnd(c, now),
      })),
    invites: {
      on: referralsEnabled(rules),
      code: stats.code,
      link: stats.link,
      joined: stats.joined,
      qualified: stats.qualified,
      earnedSats: stats.earnedSats.toString(),
      usedThisMonth: referrerRewardsInMonth(mine, now.toISOString()),
      maxPerMonth: rules.maxPerReferrerPerMonth,
      referrerSats: rules.referrerSats.toString(),
      friendSats: rules.friendSats.toString(),
      qualifyingSats: rules.qualifyingSats.toString(),
      friends: mine
        .sort((a, b) => (a.joinedAt < b.joinedAt ? 1 : -1))
        .map((r) => ({
          masked: describeIdentity(r.friendId).masked,
          joinedAt: r.joinedAt,
          qualified: !!r.qualifiedAt,
        })),
    },
    rewards: {
      pendingSats: sum.pendingSats.toString(),
      payableSats: sum.payableSats.toString(),
      paidSats: sum.paidSats.toString(),
    },
    links: links.filter((l) => l.expiresAt > now.toISOString()).length,
    contact: {
      signal: chatLinks().signal,
      discord: env.NEXT_PUBLIC_DISCORD_INVITE?.trim() || undefined,
      email: env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || undefined,
    },
  }
}

export type MeOp =
  | { op: "limits"; dailyCapSats?: string; perActionCapSats?: string; confirmAboveSats?: string }
  | { op: "rail"; rail: keyof Policy["rails"]; on: boolean }
  | { op: "kill"; on: boolean }
  | { op: "allow_add" | "allow_remove" | "deny_add" | "deny_remove"; destination: string }
  | { op: "card"; id: string; state: "pause" | "resume" }
  | { op: "logout" }
  | { op: "logout_all" }

export type MeOpResult =
  | { ok: true; policy?: Policy; card?: { id: string; state: VirtualCard["state"] } }
  | { ok: false; error: string }

const RAILS = ["wallet", "exchange", "goods", "compute", "onchain"] as const

/** The few writes the workspace allows. Each is the same change chat would make. */
export async function applyMeOp(
  token: string | undefined,
  body: unknown,
  now = new Date(),
): Promise<MeOpResult> {
  const s = await meStoresReady()
  const userId = await userForToken(s, token, now)
  if (!userId || !token) return { ok: false, error: "This link is not valid any more" }
  const b = (body ?? {}) as Partial<MeOp> & Record<string, unknown>
  const policy = (await s.policies.get(userId)) ?? DEFAULT_POLICY
  const save = async (patch: PolicyPatch): Promise<MeOpResult> => {
    const r = patchPolicy(policy, patch)
    if (!r.ok) return r
    await s.policies.set(userId, r.policy)
    return { ok: true, policy: r.policy }
  }
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined)
  switch (b.op) {
    case "limits":
      return save({
        dailyCapSats: str("dailyCapSats"),
        perActionCapSats: str("perActionCapSats"),
        confirmAboveSats: str("confirmAboveSats"),
      })
    case "rail": {
      const rail = str("rail") as (typeof RAILS)[number] | undefined
      if (!rail || !RAILS.includes(rail)) return { ok: false, error: "Unknown rail" }
      return save({ rails: { [rail]: b.on === true } })
    }
    case "kill":
      return save({ killSwitch: b.on === true })
    case "allow_add":
      return save({ allowAdd: str("destination") ?? "" })
    case "allow_remove":
      return save({ allowRemove: str("destination") ?? "" })
    case "deny_add":
      return save({ denyAdd: str("destination") ?? "" })
    case "deny_remove":
      return save({ denyRemove: str("destination") ?? "" })
    case "card": {
      const cards = getCardStore()
      const c = str("id") ? await cards.get(str("id") as string) : null
      if (!c || c.userId !== userId || c.state === "closed")
        return { ok: false, error: "No such card" }
      const state = b.state === "pause" ? "paused" : b.state === "resume" ? "active" : null
      if (!state) return { ok: false, error: "state must be pause or resume" }
      await cards.update({ ...c, state })
      return { ok: true, card: { id: c.id, state } }
    }
    case "logout":
      await s.webLinks.revoke(hashWebToken(token))
      return { ok: true }
    case "logout_all":
      await s.webLinks.revokeAll(userId)
      return { ok: true }
    default:
      return { ok: false, error: "Unknown op" }
  }
}
