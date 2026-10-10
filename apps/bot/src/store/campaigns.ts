/**
 * Campaign stores (M11): file-backed for a single operator, Supabase in production. Tables in
 * supabase/migrations/0006_campaigns.sql. Progress is never stored; it is computed from
 * contributions and pledges (core `campaignProgress`).
 */
import {
  CAMPAIGN_SLUG_RE,
  type Campaign,
  type CampaignStore,
  type CampaignUpdate,
  type Contribution,
  type Pledge,
} from "@agentic-bitcoin/core"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { FileState } from "./file"

const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))
const dec = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x,
  ) as T

/** One bucket, prefixed keys: c:<slug> campaign · u:<id> update · x:<hash|id> contribution · p:<scheduleId> pledge · f:<slug>|<user> follow · d:<slug>|<user> delivered marker. */
export class FileCampaignStore implements CampaignStore {
  readonly kind = "file"
  constructor(private readonly f: FileState) {}
  private vals<T>(prefix: string): T[] {
    return this.f
      .keys("campaigns")
      .filter((k) => k.startsWith(prefix))
      .map((k) => dec<T>(this.f.get("campaigns", k) ?? ""))
  }
  async get(slug: string) {
    const v = this.f.get("campaigns", `c:${slug.toLowerCase()}`)
    return v ? dec<Campaign>(v) : null
  }
  async listForRecipient(recipientSlug: string) {
    return this.vals<Campaign>("c:").filter((c) => c.recipientSlug === recipientSlug)
  }
  async listActive() {
    return this.vals<Campaign>("c:").filter((c) => c.active)
  }
  async updates(campaignSlug: string, limit = 20) {
    return this.vals<CampaignUpdate>("u:")
      .filter((u) => u.campaignSlug === campaignSlug)
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit)
  }
  async contributions(campaignSlug: string) {
    return this.vals<Contribution>("x:").filter((c) => c.campaignSlug === campaignSlug)
  }
  async pledges(campaignSlug: string) {
    return this.vals<Pledge>("p:").filter((p) => p.campaignSlug === campaignSlug)
  }
  async upsert(c: Campaign) {
    if (!CAMPAIGN_SLUG_RE.test(c.slug)) throw new Error(`bad slug: ${c.slug}`)
    this.f.set("campaigns", `c:${c.slug}`, enc(c))
  }
  async addUpdate(u: CampaignUpdate) {
    this.f.set("campaigns", `u:${u.id}`, enc(u))
  }
  async addContribution(c: Contribution) {
    const key = `x:${c.paymentHash ? c.paymentHash.toLowerCase() : `${c.at}:${Math.random().toString(36).slice(2, 8)}`}`
    if (c.paymentHash && this.f.get("campaigns", key)) return
    this.f.set("campaigns", key, enc(c))
  }
  async setPledge(p: Pledge) {
    this.f.set("campaigns", `p:${p.scheduleId}`, enc(p))
  }
  async follow(campaignSlug: string, userId: string) {
    this.f.set("campaigns", `f:${campaignSlug}|${userId}`, "1")
  }
  async unfollow(campaignSlug: string, userId: string) {
    this.f.set("campaigns", `f:${campaignSlug}|${userId}`, null)
    this.f.set("campaigns", `d:${campaignSlug}|${userId}`, null)
  }
  async followers(campaignSlug: string) {
    return this.f
      .keys("campaigns")
      .filter((k) => k.startsWith(`f:${campaignSlug}|`))
      .map((k) => k.slice(`f:${campaignSlug}|`.length))
  }
  async following(userId: string) {
    return this.f
      .keys("campaigns")
      .filter((k) => k.startsWith("f:") && k.endsWith(`|${userId}`))
      .map((k) => k.slice(2, -(userId.length + 1)))
  }
  /** Update-delivery markers (bot only). */
  lastDelivered(campaignSlug: string, userId: string): string | null {
    return this.f.get("campaigns", `d:${campaignSlug}|${userId}`)
  }
  markDelivered(campaignSlug: string, userId: string, at: string): void {
    this.f.set("campaigns", `d:${campaignSlug}|${userId}`, at)
  }
}

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
const fromCampaignRow = (r: CampaignRow): Campaign => ({
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
  constructor(private readonly db: SupabaseClient) {}
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
    return d ? fromCampaignRow(d) : null
  }
  async listForRecipient(recipientSlug: string) {
    return (
      await this.q<CampaignRow[]>(
        this.db.from("campaigns").select("*").eq("recipient_slug", recipientSlug),
        "campaign list",
      )
    ).map(fromCampaignRow)
  }
  async listActive() {
    return (
      await this.q<CampaignRow[]>(
        this.db.from("campaigns").select("*").eq("active", true),
        "campaign list",
      )
    ).map(fromCampaignRow)
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
  async lastDelivered(campaignSlug: string, userId: string): Promise<string | null> {
    const d = await this.q<{ delivered_at: string | null } | null>(
      this.db
        .from("campaign_followers")
        .select("delivered_at")
        .eq("campaign_slug", campaignSlug)
        .eq("user_id", userId)
        .maybeSingle(),
      "delivered read",
    )
    return d?.delivered_at ?? null
  }
  async markDelivered(campaignSlug: string, userId: string, at: string): Promise<void> {
    await this.q(
      this.db
        .from("campaign_followers")
        .update({ delivered_at: at })
        .eq("campaign_slug", campaignSlug)
        .eq("user_id", userId),
      "delivered write",
    )
  }
}

/** Deliver new campaign updates to followers, once each. Pure over the store and a send function. */
export async function deliverCampaignUpdates(
  store: CampaignStore & {
    lastDelivered(campaignSlug: string, userId: string): Promise<string | null> | string | null
    markDelivered(campaignSlug: string, userId: string, at: string): Promise<void> | void
  },
  send: (userId: string, text: string) => Promise<void>,
  opts: { siteUrl?: string } = {},
): Promise<number> {
  let delivered = 0
  for (const c of await store.listActive()) {
    const updates = await store.updates(c.slug, 10)
    if (!updates.length) continue
    const newest = updates[0] as CampaignUpdate
    for (const userId of await store.followers(c.slug)) {
      const last = await store.lastDelivered(c.slug, userId)
      const fresh = updates.filter((u) => !last || u.at > last).reverse()
      if (!fresh.length) continue
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
      const clean = (t: string) => t.replace(/[\u0000-\u001f]/g, " ").slice(0, 600)
      const body = fresh.map((u) => `• ${u.at.slice(0, 10)}: ${clean(u.text)}`).join("\n")
      await send(
        userId,
        `Update from ${c.title} (${c.slug}):\n${body}\n${opts.siteUrl ? `${opts.siteUrl}/campaigns/${c.slug}\n` : ""}Reply /unfollow ${c.slug} to stop these.`,
      )
      await store.markDelivered(c.slug, userId, newest.at)
      delivered++
    }
  }
  return delivered
}
