/** Supabase ScheduleStore. Table in supabase/migrations/0003_schedules.sql; money as "123n" strings. */
import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import type { Schedule, ScheduleStore } from "./schedule"

type Row = {
  id: string
  user_id: string
  exchange: string
  usd_cents: string
  cron: string
  estimated_sats: string
  sweep_to_wallet: boolean
  active: boolean
  created_at: string
  last_run_at: string | null
}

const toRow = (s: Schedule): Row => ({
  id: s.id,
  user_id: s.userId,
  exchange: s.exchange,
  usd_cents: s.usdCents.toString(),
  cron: s.cron,
  estimated_sats: s.estimatedSats.toString(),
  sweep_to_wallet: s.sweepToWallet,
  active: s.active,
  created_at: s.createdAt,
  last_run_at: s.lastRunAt,
})
const fromRow = (r: Row): Schedule => ({
  id: r.id,
  userId: r.user_id,
  exchange: r.exchange as Schedule["exchange"],
  usdCents: BigInt(r.usd_cents),
  cron: r.cron,
  estimatedSats: BigInt(r.estimated_sats),
  sweepToWallet: r.sweep_to_wallet,
  active: r.active,
  createdAt: r.created_at,
  lastRunAt: r.last_run_at,
})

export class SupabaseScheduleStore implements ScheduleStore {
  readonly kind = "supabase"
  constructor(
    private readonly db: SupabaseClient,
    private readonly now: () => Date = () => new Date(),
  ) {}
  static connect(url: string, serviceKey: string): SupabaseScheduleStore {
    return new SupabaseScheduleStore(
      createClient(url, serviceKey, { auth: { persistSession: false } }),
    )
  }
  async create(s: Omit<Schedule, "id" | "createdAt" | "lastRunAt" | "active">): Promise<Schedule> {
    const full: Schedule = {
      ...s,
      id: `sch_${crypto.randomUUID().slice(0, 12)}`,
      createdAt: this.now().toISOString(),
      lastRunAt: null,
      active: true,
    }
    const { error } = await this.db.from("schedules").insert(toRow(full))
    if (error) throw new Error(`schedule create failed: ${error.message}`)
    return full
  }
  async get(id: string): Promise<Schedule | null> {
    const { data, error } = await this.db.from("schedules").select("*").eq("id", id).maybeSingle()
    if (error) throw new Error(`schedule read failed: ${error.message}`)
    return data ? fromRow(data as Row) : null
  }
  async listActive(): Promise<Schedule[]> {
    const { data, error } = await this.db.from("schedules").select("*").eq("active", true)
    if (error) throw new Error(`schedule list failed: ${error.message}`)
    return (data as Row[]).map(fromRow)
  }
  async listForUser(userId: string): Promise<Schedule[]> {
    const { data, error } = await this.db.from("schedules").select("*").eq("user_id", userId)
    if (error) throw new Error(`schedule list failed: ${error.message}`)
    return (data as Row[]).map(fromRow)
  }
  async cancel(id: string): Promise<void> {
    const { error } = await this.db.from("schedules").update({ active: false }).eq("id", id)
    if (error) throw new Error(`schedule cancel failed: ${error.message}`)
  }
  async markRun(id: string, at: string): Promise<void> {
    const { error } = await this.db.from("schedules").update({ last_run_at: at }).eq("id", id)
    if (error) throw new Error(`schedule mark failed: ${error.message}`)
  }
}
