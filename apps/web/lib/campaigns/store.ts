/**
 * Campaign storage for the web (M11): the same tables the bot uses (supabase/migrations/0006).
 * Keyless dev uses core's in-memory store, shared across route modules on globalThis.
 */
import {
  CAMPAIGN_SLUG_RE,
  type Campaign,
  type CampaignStore,
  type CampaignUpdate,
  type Contribution,
  InMemoryCampaignStore,
  type Pledge,
} from "@agentic-bitcoin/core"
import { type SupabaseClient, createClient } from "@supabase/supabase-js"

type CampaignRow = {
  slug: string
  recipient_slug: string
  title: string
  story: string | null
  goal_usd_cents_per_month: string | null
  goal_sats_total: string | null
  starts_at: string
  ends_at: string | null
  active: boolean
}
const fromRow = (r: CampaignRow): Campaign => ({
  slug: r.slug,
  recipientSlug: r.recipient_slug,
  title: r.title,
  story: r.story ?? undefined,
  goal: r.goal_sats_total
    ? { satsTotal: BigInt(r.goal_sats_total) }
    : { usdCentsPerMonth: BigInt(r.goal_usd_cents_per_month ?? "0") },
  startsAt: r.starts_at,
  endsAt: r.ends_at ?? undefined,
  active: r.active,
})

export class SupabaseCampaignStore implements CampaignStore {
  readonly kind = "supabase"
  private readonly db: SupabaseClient
  constructor(url: string, key: string) {
    this.db = createClient(url, key, { auth: { persistSession: false } })
  }
  private async q<T>(
    p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
    what: string,
  ): Promise<T> {
    const { data, error } = await p
    if (error) throw new Error(`${what} failed: ${error.message}`)
    return data as T
  }
  async get(slug: string) {
    const d = await this.q<CampaignRow | null>(
      this.db.from("campaigns").select("*").eq("slug", slug.toLowerCase()).maybeSingle(),
      "campaign read",
    )
    return d ? fromRow(d) : null
  }
  async listForRecipient(recipientSlug: string) {
    return (
      await this.q<CampaignRow[]>(
        this.db.from("campaigns").select("*").eq("recipient_slug", recipientSlug),
        "campaign list",
      )
    ).map(fromRow)
  }
  async listActive() {
    return (
      await this.q<CampaignRow[]>(
        this.db
          .from("campaigns")
          .select("*")
          .eq("active", true)
          .order("starts_at", { ascending: false }),
        "campaign list",
      )
    ).map(fromRow)
  }
  async updates(campaignSlug: string, limit = 20) {
    const rows = await this.q<{ id: string; campaign_slug: string; at: string; text: string }[]>(
      this.db
        .from("campaign_updates")
        .select("*")
        .eq("campaign_slug", campaignSlug)
        .order("at", { ascending: false })
        .limit(limit),
      "updates read",
    )
    return rows.map((u) => ({ id: u.id, campaignSlug: u.campaign_slug, at: u.at, text: u.text }))
  }
  async contributions(campaignSlug: string) {
    const rows = await this.q<
      {
        campaign_slug: string
        payment_hash: string | null
        amount_msats: string
        at: string
        source: string
        supporter_key: string | null
        supporter_name: string | null
      }[]
    >(
      this.db.from("campaign_contributions").select("*").eq("campaign_slug", campaignSlug),
      "contributions read",
    )
    return rows.map((c) => ({
      campaignSlug: c.campaign_slug,
      paymentHash: c.payment_hash ?? undefined,
      amountMsats: BigInt(c.amount_msats),
      at: c.at,
      source: c.source as Contribution["source"],
      supporterKey: c.supporter_key ?? undefined,
      supporterName: c.supporter_name ?? undefined,
    }))
  }
  async pledges(campaignSlug: string) {
    const rows = await this.q<
      {
        schedule_id: string
        campaign_slug: string
        supporter_key: string
        amount_sats: string
        usd_cents: string | null
        cron: string
        active: boolean
      }[]
    >(
      this.db.from("campaign_pledges").select("*").eq("campaign_slug", campaignSlug),
      "pledges read",
    )
    return rows.map((p) => ({
      scheduleId: p.schedule_id,
      campaignSlug: p.campaign_slug,
      supporterKey: p.supporter_key,
      amountSats: BigInt(p.amount_sats),
      usdCents: p.usd_cents ? BigInt(p.usd_cents) : undefined,
      cron: p.cron,
      active: p.active,
    }))
  }
  async upsert(c: Campaign) {
    if (!CAMPAIGN_SLUG_RE.test(c.slug)) throw new Error(`bad slug: ${c.slug}`)
    await this.q(
      this.db.from("campaigns").upsert({
        slug: c.slug,
        recipient_slug: c.recipientSlug,
        title: c.title,
        story: c.story ?? null,
        goal_usd_cents_per_month:
          "usdCentsPerMonth" in c.goal ? c.goal.usdCentsPerMonth.toString() : null,
        goal_sats_total: "satsTotal" in c.goal ? c.goal.satsTotal.toString() : null,
        starts_at: c.startsAt,
        ends_at: c.endsAt ?? null,
        active: c.active,
      }),
      "campaign write",
    )
  }
  async addUpdate(u: CampaignUpdate) {
    await this.q(
      this.db
        .from("campaign_updates")
        .insert({ id: u.id, campaign_slug: u.campaignSlug, at: u.at, text: u.text }),
      "update write",
    )
  }
  async addContribution(c: Contribution) {
    const { error } = await this.db.from("campaign_contributions").insert({
      campaign_slug: c.campaignSlug,
      payment_hash: c.paymentHash?.toLowerCase() ?? null,
      amount_msats: c.amountMsats.toString(),
      at: c.at,
      source: c.source,
      supporter_key: c.supporterKey ?? null,
      supporter_name: c.supporterName ?? null,
    })
    if (error && error.code !== "23505")
      throw new Error(`contribution write failed: ${error.message}`)
  }
  async setPledge(p: Pledge) {
    await this.q(
      this.db.from("campaign_pledges").upsert({
        schedule_id: p.scheduleId,
        campaign_slug: p.campaignSlug,
        supporter_key: p.supporterKey,
        amount_sats: p.amountSats.toString(),
        usd_cents: p.usdCents?.toString() ?? null,
        cron: p.cron,
        active: p.active,
      }),
      "pledge write",
    )
  }
  async follow(campaignSlug: string, userId: string) {
    const { error } = await this.db
      .from("campaign_followers")
      .upsert({ campaign_slug: campaignSlug, user_id: userId })
    if (error) throw new Error(`follow failed: ${error.message}`)
  }
  async unfollow(campaignSlug: string, userId: string) {
    await this.q(
      this.db
        .from("campaign_followers")
        .delete()
        .eq("campaign_slug", campaignSlug)
        .eq("user_id", userId),
      "unfollow",
    )
  }
  async followers(campaignSlug: string) {
    return (
      await this.q<{ user_id: string }[]>(
        this.db.from("campaign_followers").select("user_id").eq("campaign_slug", campaignSlug),
        "followers",
      )
    ).map((r) => r.user_id)
  }
  async following(userId: string) {
    return (
      await this.q<{ campaign_slug: string }[]>(
        this.db.from("campaign_followers").select("campaign_slug").eq("user_id", userId),
        "following",
      )
    ).map((r) => r.campaign_slug)
  }
}

const g = globalThis as { __campaignStore?: CampaignStore | null }
export function getCampaignStore(): CampaignStore {
  if (g.__campaignStore) return g.__campaignStore
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  g.__campaignStore = url && key ? new SupabaseCampaignStore(url, key) : new InMemoryCampaignStore()
  return g.__campaignStore
}
export function __setCampaignStore(s: CampaignStore | null): void {
  g.__campaignStore = s
}
