/**
 * Campaign service (M11): progress for pages, and the recipient's dashboard actions (create a
 * campaign, post an update, report an offline gift), all behind the dashboard token.
 */
import { randomUUID } from "node:crypto"
import {
  CAMPAIGN_SLUG_RE,
  type Campaign,
  type CampaignProgress,
  type CampaignStore,
  type CampaignUpdate,
  type Contribution,
  type PriceSnapshot,
  campaignProgress,
  centsToSats,
  slugify,
} from "@agentic-bitcoin/core"
import { hashToken } from "../receive/service"
import type { ReceiveStore } from "../receive/store"

export interface CampaignDeps {
  campaigns: CampaignStore
  receive: ReceiveStore
  price?: PriceSnapshot
  now?: () => Date
}

/** Contributions from every source: recorded ones plus settled web invoices tagged with the campaign. */
export async function allContributions(deps: CampaignDeps, c: Campaign): Promise<Contribution[]> {
  const recorded = await deps.campaigns.contributions(c.slug)
  const web = (await deps.receive.listInvoices(c.recipientSlug, 500))
    .filter((i) => i.campaignSlug === c.slug && i.settledAt)
    .map<Contribution>((i) => ({
      campaignSlug: c.slug,
      paymentHash: i.paymentHash,
      amountMsats: BigInt(i.amountMsats),
      at: i.settledAt as string,
      source: "web",
      supporterName: undefined,
    }))
  return [...recorded, ...web]
}

export async function progressFor(deps: CampaignDeps, c: Campaign): Promise<CampaignProgress> {
  const price = deps.price
  return campaignProgress(
    c,
    await allContributions(deps, c),
    await deps.campaigns.pledges(c.slug),
    {
      satsPerUsdCent: price ? (cents) => centsToSats(cents, price) : undefined,
    },
  )
}

export interface CampaignView {
  campaign: Campaign
  progress: CampaignProgress
  updates: CampaignUpdate[]
  /** Opt-in supporter names, most recent first, de-duplicated. */
  supporterNames: string[]
}

export async function campaignView(deps: CampaignDeps, slug: string): Promise<CampaignView | null> {
  const c = await deps.campaigns.get(slug)
  if (!c) return null
  const cs = await allContributions(deps, c)
  const names = [
    ...new Set(
      cs
        .filter((x) => x.supporterName)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .map((x) => x.supporterName as string),
    ),
  ]
  return {
    campaign: c,
    progress: await progressFor(deps, c),
    updates: await deps.campaigns.updates(c.slug, 20),
    supporterNames: names.slice(0, 50),
  }
}

async function authed(deps: CampaignDeps, recipientSlug: string, token: string) {
  const r = await deps.receive.getRecipient(recipientSlug)
  if (!r || !r.dashboardTokenHash || !token || hashToken(token) !== r.dashboardTokenHash)
    return null
  return r
}

export interface CampaignForm {
  title: string
  story?: string
  goalKind: "monthly" | "total"
  /** Dollars per month (monthly) or sats (total), as typed. */
  goalAmount: string
  endsAt?: string
}

export async function createCampaign(
  deps: CampaignDeps,
  recipientSlug: string,
  token: string,
  form: CampaignForm,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const now = deps.now ?? (() => new Date())
  const r = await authed(deps, recipientSlug, token)
  if (!r) return { ok: false, error: "Not authorized." }
  const title = (form.title ?? "").trim().slice(0, 100)
  if (title.length < 3) return { ok: false, error: "Give the campaign a title." }
  const base = slugify(`${r.slug} ${title}`)
  if (!CAMPAIGN_SLUG_RE.test(base))
    return { ok: false, error: "That title does not make a usable slug." }
  let slug = base
  for (let i = 2; await deps.campaigns.get(slug); i++) slug = `${base}-${i}`.slice(0, 63)
  const amount = (form.goalAmount ?? "").replace(/[,$_\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
    return { ok: false, error: "Enter a goal amount." }
  const goal: Campaign["goal"] =
    form.goalKind === "total"
      ? { satsTotal: BigInt(amount.split(".")[0] ?? "0") }
      : { usdCentsPerMonth: BigInt(Math.round(Number(amount) * 100)) } // money-ok: parsing a typed dollar amount at the form boundary
  if ("satsTotal" in goal && goal.satsTotal < 1n)
    return { ok: false, error: "Enter a goal in whole sats." }
  let endsAt: string | undefined
  if (form.endsAt?.trim()) {
    const d = new Date(form.endsAt)
    if (Number.isNaN(d.getTime())) return { ok: false, error: "End date is not a date." }
    endsAt = d.toISOString()
  }
  await deps.campaigns.upsert({
    slug,
    recipientSlug: r.slug,
    title,
    story: form.story?.trim().slice(0, 2000) || undefined,
    goal,
    startsAt: now().toISOString(),
    endsAt,
    active: true,
  })
  return { ok: true, slug }
}

export async function closeCampaign(
  deps: CampaignDeps,
  recipientSlug: string,
  token: string,
  slug: string,
) {
  const r = await authed(deps, recipientSlug, token)
  const c = r ? await deps.campaigns.get(slug) : null
  if (!r || !c || c.recipientSlug !== r.slug)
    return { ok: false as const, error: "Not authorized." }
  await deps.campaigns.upsert({ ...c, active: false })
  return { ok: true as const }
}

export async function postUpdate(
  deps: CampaignDeps,
  recipientSlug: string,
  token: string,
  slug: string,
  text: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const now = deps.now ?? (() => new Date())
  const r = await authed(deps, recipientSlug, token)
  const c = r ? await deps.campaigns.get(slug) : null
  if (!r || !c || c.recipientSlug !== r.slug) return { ok: false, error: "Not authorized." }
  const body = (text ?? "").trim().slice(0, 2000)
  if (body.length < 2) return { ok: false, error: "Write something first." }
  const u = { id: randomUUID(), campaignSlug: c.slug, at: now().toISOString(), text: body }
  await deps.campaigns.addUpdate(u)
  return { ok: true, id: u.id }
}

/** A gift the recipient received outside our rails (cash, bank). Flagged as reported; never trusted as settlement. */
export async function reportGift(
  deps: CampaignDeps,
  recipientSlug: string,
  token: string,
  slug: string,
  sats: string,
  at?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = deps.now ?? (() => new Date())
  const r = await authed(deps, recipientSlug, token)
  const c = r ? await deps.campaigns.get(slug) : null
  if (!r || !c || c.recipientSlug !== r.slug) return { ok: false, error: "Not authorized." }
  const n = (sats ?? "").replace(/[,_\s]/g, "")
  if (!/^\d{1,12}$/.test(n) || BigInt(n) < 1n) return { ok: false, error: "Enter whole sats." }
  const when = at ? new Date(at) : now()
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Date is not a date." }
  await deps.campaigns.addContribution({
    campaignSlug: c.slug,
    amountMsats: BigInt(n) * 1000n,
    at: when.toISOString(),
    source: "reported",
  })
  return { ok: true }
}
