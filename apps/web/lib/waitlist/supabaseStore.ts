import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import { WaitlistError } from "./errors"
import type { WaitlistEntry, WaitlistStore } from "./store"

/** Supabase-backed store. Activated only when both env vars are present. See supabase/migrations. */
export class SupabaseWaitlistStore implements WaitlistStore {
  readonly kind = "supabase"
  private readonly client: SupabaseClient

  constructor(url: string, serviceKey: string) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false } })
  }

  async add(entry: WaitlistEntry): Promise<{ created: boolean }> {
    const { error } = await this.client.from("waitlist").insert({
      contact: entry.contact,
      kind: entry.kind,
      source: entry.source,
      created_at: entry.createdAt,
    })
    if (!error) return { created: true }
    // 23505 = unique_violation → already joined, treat as idempotent no-op.
    if (error.code === "23505") return { created: false }
    throw WaitlistError.storeUnavailable()
  }

  async has(contact: string): Promise<boolean> {
    const { data, error } = await this.client
      .from("waitlist")
      .select("contact")
      .eq("contact", contact)
      .maybeSingle()
    if (error) throw WaitlistError.storeUnavailable()
    return data !== null
  }

  async count(): Promise<number> {
    const { count, error } = await this.client
      .from("waitlist")
      .select("*", { count: "exact", head: true })
    if (error) throw WaitlistError.storeUnavailable()
    return count ?? 0
  }
}
