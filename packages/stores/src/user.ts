/**
 * Per-user Supabase stores shared by the bot and the web (M23). Tables in
 * supabase/migrations/0002_agent.sql (policies, user_secrets) and 0016_web_links.sql. Money
 * crosses the boundary as decimal strings ("123n"), never as JSON numbers; secrets only as the
 * encrypted blobs the bot sealed.
 */
import type {
  Policy,
  PolicyStore,
  SecretName,
  SecretStore,
  WebLink,
  WebLinkStore,
} from "@agentic-bitcoin/core"
import type { SupabaseClient } from "@supabase/supabase-js"

const enc = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))
const dec = <T>(s: string): T =>
  JSON.parse(s, (_k, x) =>
    typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x,
  ) as T

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
    const p = dec<Policy>(data.policy as string)
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
      .upsert({ user_id: userId, policy: enc(policy), updated_at: new Date().toISOString() })
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

type LinkRow = { token_hash: string; user_id: string; created_at: string; expires_at: string }
const fromRow = (r: LinkRow): WebLink => ({
  tokenHash: r.token_hash,
  userId: r.user_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
})

export class SupabaseWebLinkStore implements WebLinkStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  async userFor(tokenHash: string, now: Date): Promise<string | null> {
    const { data, error } = await this.db
      .from("web_links")
      .select("user_id, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle()
    if (error) throw new Error(`web link read failed: ${error.message}`)
    if (!data || (data.expires_at as string) <= now.toISOString()) return null
    return data.user_id as string
  }
  async create(link: WebLink): Promise<void> {
    const { error } = await this.db.from("web_links").insert({
      token_hash: link.tokenHash,
      user_id: link.userId,
      created_at: link.createdAt,
      expires_at: link.expiresAt,
    })
    if (error) throw new Error(`web link write failed: ${error.message}`)
  }
  async listForUser(userId: string): Promise<WebLink[]> {
    const { data, error } = await this.db
      .from("web_links")
      .select("token_hash, user_id, created_at, expires_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
    if (error) throw new Error(`web link list failed: ${error.message}`)
    return ((data ?? []) as LinkRow[]).map(fromRow)
  }
  async revoke(tokenHash: string): Promise<void> {
    const { error } = await this.db.from("web_links").delete().eq("token_hash", tokenHash)
    if (error) throw new Error(`web link revoke failed: ${error.message}`)
  }
  async revokeAll(userId: string): Promise<void> {
    const { error } = await this.db.from("web_links").delete().eq("user_id", userId)
    if (error) throw new Error(`web link revoke failed: ${error.message}`)
  }
}
