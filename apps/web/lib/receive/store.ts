/**
 * Receive-side storage (M10): recipients (shared table with the bot) and the invoices we minted
 * for them. Memory implementation for tests and keyless dev; Supabase in production.
 */
import type { Recipient } from "@agentic-bitcoin/core"
import { type SupabaseClient, createClient } from "@supabase/supabase-js"

export interface ReceiveInvoice {
  paymentHash: string
  slug: string
  amountMsats: number
  comment?: string
  source: "proxy" | "nwc"
  createdAt: string
  settledAt?: string
  preimage?: string
}

export interface ReceiveStore {
  readonly kind: string
  /** Directory recipients only (no owner). Includes the sealed nwc blob and token hash. */
  getRecipient(slug: string): Promise<(Recipient & { dashboardTokenHash?: string }) | null>
  createRecipient(r: Recipient & { dashboardTokenHash: string; contact?: string }): Promise<void>
  recordInvoice(inv: ReceiveInvoice): Promise<void>
  countInvoicesSince(slug: string, sinceIso: string): Promise<number>
  listInvoices(slug: string, limit: number): Promise<ReceiveInvoice[]>
  markSettled(paymentHash: string, settledAt: string, preimage?: string): Promise<void>
}

export class InMemoryReceiveStore implements ReceiveStore {
  readonly kind = "memory"
  readonly recipients = new Map<
    string,
    Recipient & { dashboardTokenHash?: string; contact?: string }
  >()
  readonly invoices: ReceiveInvoice[] = []
  constructor(seed: readonly (Recipient & { dashboardTokenHash?: string })[] = []) {
    for (const r of seed) this.recipients.set(r.slug, r)
  }
  async getRecipient(slug: string) {
    const r = this.recipients.get(slug.toLowerCase())
    return r && !r.ownerUserId ? r : null
  }
  async createRecipient(r: Recipient & { dashboardTokenHash: string; contact?: string }) {
    if (this.recipients.has(r.slug)) throw new Error("slug taken")
    this.recipients.set(r.slug, r)
  }
  async recordInvoice(inv: ReceiveInvoice) {
    this.invoices.push(inv)
  }
  async countInvoicesSince(slug: string, sinceIso: string) {
    return this.invoices.filter((i) => i.slug === slug && i.createdAt >= sinceIso).length
  }
  async listInvoices(slug: string, limit: number) {
    return this.invoices
      .filter((i) => i.slug === slug)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit)
  }
  async markSettled(paymentHash: string, settledAt: string, preimage?: string) {
    const i = this.invoices.find((x) => x.paymentHash === paymentHash)
    if (i) {
      i.settledAt = settledAt
      i.preimage = preimage
    }
  }
}

type RecipientRow = {
  slug: string
  kind: string
  name: string
  lightning_address: string
  verified_how: string | null
  verified_at: string | null
  website: string | null
  country: string | null
  description: string | null
  owner_user_id: string | null
  nwc_receive: string | null
  dashboard_token_hash: string | null
  submitted_at: string | null
}
type InvoiceRow = {
  payment_hash: string
  slug: string
  amount_msats: string
  comment: string | null
  source: string
  created_at: string
  settled_at: string | null
  preimage: string | null
}

export class SupabaseReceiveStore implements ReceiveStore {
  readonly kind = "supabase"
  private readonly db: SupabaseClient
  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } })
  }
  async getRecipient(slug: string) {
    const { data, error } = await this.db
      .from("recipients")
      .select("*")
      .eq("slug", slug.toLowerCase())
      .is("owner_user_id", null)
      .maybeSingle()
    if (error) throw new Error(`recipient read failed: ${error.message}`)
    if (!data) return null
    const r = data as RecipientRow
    return {
      slug: r.slug,
      kind: r.kind as Recipient["kind"],
      name: r.name,
      lightningAddress: r.lightning_address,
      verified:
        r.verified_how && r.verified_at
          ? { how: r.verified_how as "domain" | "operator", at: r.verified_at }
          : null,
      website: r.website ?? undefined,
      country: r.country ?? undefined,
      description: r.description ?? undefined,
      nwcReceive: r.nwc_receive ?? undefined,
      submittedAt: r.submitted_at ?? undefined,
      dashboardTokenHash: r.dashboard_token_hash ?? undefined,
    }
  }
  async createRecipient(r: Recipient & { dashboardTokenHash: string; contact?: string }) {
    const { error } = await this.db.from("recipients").insert({
      slug: r.slug,
      kind: r.kind,
      name: r.name,
      lightning_address: r.lightningAddress,
      verified_how: r.verified?.how ?? null,
      verified_at: r.verified?.at ?? null,
      website: r.website ?? null,
      country: r.country ?? null,
      description: r.description ?? null,
      owner_user_id: null,
      nwc_receive: r.nwcReceive ?? null,
      dashboard_token_hash: r.dashboardTokenHash,
      contact: r.contact ?? null,
      submitted_at: r.submittedAt ?? new Date().toISOString(),
    })
    if (error)
      throw new Error(
        error.code === "23505" ? "slug taken" : `recipient write failed: ${error.message}`,
      )
  }
  async recordInvoice(inv: ReceiveInvoice) {
    const { error } = await this.db.from("receive_invoices").insert({
      payment_hash: inv.paymentHash,
      slug: inv.slug,
      amount_msats: String(inv.amountMsats),
      comment: inv.comment ?? null,
      source: inv.source,
      created_at: inv.createdAt,
    })
    if (error) throw new Error(`invoice record failed: ${error.message}`)
  }
  async countInvoicesSince(slug: string, sinceIso: string) {
    const { count, error } = await this.db
      .from("receive_invoices")
      .select("payment_hash", { count: "exact", head: true })
      .eq("slug", slug)
      .gte("created_at", sinceIso)
    if (error) throw new Error(`invoice count failed: ${error.message}`)
    return count ?? 0
  }
  async listInvoices(slug: string, limit: number) {
    const { data, error } = await this.db
      .from("receive_invoices")
      .select("*")
      .eq("slug", slug)
      .order("created_at", { ascending: false })
      .limit(limit)
    if (error) throw new Error(`invoice list failed: ${error.message}`)
    return ((data ?? []) as InvoiceRow[]).map((i) => ({
      paymentHash: i.payment_hash,
      slug: i.slug,
      amountMsats: Number(i.amount_msats),
      comment: i.comment ?? undefined,
      source: i.source as "proxy" | "nwc",
      createdAt: i.created_at,
      settledAt: i.settled_at ?? undefined,
      preimage: i.preimage ?? undefined,
    }))
  }
  async markSettled(paymentHash: string, settledAt: string, preimage?: string) {
    const { error } = await this.db
      .from("receive_invoices")
      .update({ settled_at: settledAt, preimage: preimage ?? null })
      .eq("payment_hash", paymentHash)
    if (error) throw new Error(`invoice settle failed: ${error.message}`)
  }
}

// The keyless fallback lives on globalThis: Next dev gives every route its own module instance, and
// a recipient onboarded through one route must be visible to the LNURL routes in the same process.
const g = globalThis as { __receiveStore?: ReceiveStore | null }
export function getReceiveStore(): ReceiveStore {
  if (g.__receiveStore) return g.__receiveStore
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  g.__receiveStore = url && key ? new SupabaseReceiveStore(url, key) : new InMemoryReceiveStore()
  return g.__receiveStore
}
export function __setReceiveStore(s: ReceiveStore | null): void {
  g.__receiveStore = s
}
