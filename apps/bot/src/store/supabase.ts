/**
 * Supabase implementations. Tables in supabase/migrations/0002_agent.sql. Money crosses the
 * boundary as decimal strings ("123n"), never as JSON numbers.
 */
import type { LlmMessage } from "@agentic-bitcoin/agent"
import {
  type LedgerEvent,
  type LedgerStore,
  parseAction,
  serializeAction,
} from "@agentic-bitcoin/core"
import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import type { HistoryStore, LedgerStoreFactory } from "./stores"

export function supabaseClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

const encode = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))
const decode = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x,
  ) as T

export class SupabaseLedgerStore implements LedgerStore {
  readonly kind = "supabase"
  constructor(
    private readonly db: SupabaseClient,
    private readonly userId: string,
  ) {}
  async append(event: LedgerEvent): Promise<void> {
    const payload =
      event.type === "requested" ? { ...event, action: serializeAction(event.action) } : event
    const { error } = await this.db.from("ledger_events").insert({
      user_id: this.userId,
      action_id: event.id,
      type: event.type,
      at: event.at,
      payload: encode(payload),
    })
    if (error) throw new Error(`ledger append failed: ${error.message}`)
  }
  async events(since?: string): Promise<readonly LedgerEvent[]> {
    let q = this.db
      .from("ledger_events")
      .select("payload")
      .eq("user_id", this.userId)
      .order("at", { ascending: true })
      .order("seq", { ascending: true })
    if (since) q = q.gte("at", since)
    const { data, error } = await q
    if (error) throw new Error(`ledger read failed: ${error.message}`)
    return (data ?? []).map((row) => {
      const ev = decode<LedgerEvent & { action?: string }>(row.payload as string)
      if (ev.type === "requested" && typeof ev.action === "string")
        return { ...ev, action: parseAction(ev.action) }
      return ev
    })
  }
}

export class SupabaseLedgerFactory implements LedgerStoreFactory {
  constructor(private readonly db: SupabaseClient) {}
  forUser(userId: string): LedgerStore {
    return new SupabaseLedgerStore(this.db, userId)
  }
}

export {
  SupabasePolicyStore,
  SupabaseSecretStore,
  SupabaseWebLinkStore,
} from "@agentic-bitcoin/stores"

export class SupabaseHistoryStore implements HistoryStore {
  constructor(private readonly db: SupabaseClient) {}
  async get(userId: string): Promise<LlmMessage[]> {
    const { data, error } = await this.db
      .from("chat_history")
      .select("history")
      .eq("user_id", userId)
      .maybeSingle()
    if (error) throw new Error(`history read failed: ${error.message}`)
    return data ? (JSON.parse(data.history as string) as LlmMessage[]) : []
  }
  async set(userId: string, history: LlmMessage[]): Promise<void> {
    const { error } = await this.db.from("chat_history").upsert({
      user_id: userId,
      history: JSON.stringify(history),
      updated_at: new Date().toISOString(),
    })
    if (error) throw new Error(`history write failed: ${error.message}`)
  }
}
