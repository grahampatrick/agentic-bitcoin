/**
 * Supabase implementations. Tables in supabase/migrations/0002_agent.sql. Money crosses the
 * boundary as decimal strings ("123n"), never as JSON numbers.
 */
import type { LlmMessage } from "@agentic-bitcoin/agent"
import {
  type LedgerEvent,
  type LedgerStore,
  type Policy,
  parseAction,
  serializeAction,
} from "@agentic-bitcoin/core"
import { type SupabaseClient, createClient } from "@supabase/supabase-js"
import type {
  HistoryStore,
  LedgerStoreFactory,
  PolicyStore,
  SecretName,
  SecretStore,
} from "./stores"

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

export class SupabasePolicyStore implements PolicyStore {
  constructor(private readonly db: SupabaseClient) {}
  async get(userId: string): Promise<Policy | null> {
    const { data, error } = await this.db
      .from("policies")
      .select("policy")
      .eq("user_id", userId)
      .maybeSingle()
    if (error) throw new Error(`policy read failed: ${error.message}`)
    if (!data) return null
    const p = decode<Policy>(data.policy as string)
    // rows written before M8 lack these fields
    return {
      ...p,
      coldStorageAddresses: p.coldStorageAddresses ?? [],
      rails: { ...p.rails, onchain: p.rails.onchain ?? false },
    }
  }
  async set(userId: string, policy: Policy): Promise<void> {
    const { error } = await this.db
      .from("policies")
      .upsert({ user_id: userId, policy: encode(policy), updated_at: new Date().toISOString() })
    if (error) throw new Error(`policy write failed: ${error.message}`)
  }
}

export class SupabaseSecretStore implements SecretStore {
  constructor(private readonly db: SupabaseClient) {}
  async get(userId: string, name: SecretName): Promise<string | null> {
    const { data, error } = await this.db
      .from("user_secrets")
      .select("blob")
      .eq("user_id", userId)
      .eq("name", name)
      .maybeSingle()
    if (error) throw new Error(`secret read failed: ${error.message}`)
    return data ? (data.blob as string) : null
  }
  async set(userId: string, name: SecretName, blob: string): Promise<void> {
    const { error } = await this.db
      .from("user_secrets")
      .upsert({ user_id: userId, name, blob, updated_at: new Date().toISOString() })
    if (error) throw new Error(`secret write failed: ${error.message}`)
  }
  async delete(userId: string, name: SecretName): Promise<void> {
    const { error } = await this.db
      .from("user_secrets")
      .delete()
      .eq("user_id", userId)
      .eq("name", name)
    if (error) throw new Error(`secret delete failed: ${error.message}`)
  }
}

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
