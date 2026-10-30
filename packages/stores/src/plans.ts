/**
 * The shop plan rows (M24). Dates only: the money is an ordinary invoice row. Table in
 * supabase/migrations/0017_plans.sql.
 */
import type { MerchantPlan, PlanStore } from "@agentic-bitcoin/core"
import type { SupabaseClient } from "@supabase/supabase-js"

interface Row {
  slug: string
  started_at: string
  pilot_ends_at: string
  paid_through_at: string | null
  open_invoice_id: string | null
  applied_invoice_ids: string
  updated_at: string
}

const fromRow = (r: Row): MerchantPlan => ({
  slug: r.slug,
  startedAt: r.started_at,
  pilotEndsAt: r.pilot_ends_at,
  paidThroughAt: r.paid_through_at ?? undefined,
  openInvoiceId: r.open_invoice_id ?? undefined,
  appliedInvoiceIds: JSON.parse(r.applied_invoice_ids || "[]") as string[],
  updatedAt: r.updated_at,
})

const COLS =
  "slug, started_at, pilot_ends_at, paid_through_at, open_invoice_id, applied_invoice_ids, updated_at"

export class SupabasePlanStore implements PlanStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  async get(slug: string): Promise<MerchantPlan | null> {
    const { data, error } = await this.db
      .from("merchant_plans")
      .select(COLS)
      .eq("slug", slug)
      .maybeSingle()
    if (error) throw new Error(`plan read failed: ${error.message}`)
    return data ? fromRow(data as Row) : null
  }
  async upsert(p: MerchantPlan): Promise<void> {
    const { error } = await this.db.from("merchant_plans").upsert({
      slug: p.slug,
      started_at: p.startedAt,
      pilot_ends_at: p.pilotEndsAt,
      paid_through_at: p.paidThroughAt ?? null,
      open_invoice_id: p.openInvoiceId ?? null,
      applied_invoice_ids: JSON.stringify(p.appliedInvoiceIds),
      updated_at: p.updatedAt,
    })
    if (error) throw new Error(`plan write failed: ${error.message}`)
  }
  async list(): Promise<MerchantPlan[]> {
    const { data, error } = await this.db.from("merchant_plans").select(COLS)
    if (error) throw new Error(`plan list failed: ${error.message}`)
    return ((data ?? []) as Row[]).map(fromRow)
  }
}
