/**
 * Recipient directory stores (M9). Supabase table in supabase/migrations/0004_giving.sql; the
 * file store lives in file.ts. `seedRecipients` loads the operator's directory file at boot so a
 * single-operator install can list its church and missionaries without a database.
 */
import { readFileSync } from "node:fs"
import {
  RECIPIENT_KINDS,
  type Recipient,
  type RecipientStore,
  SLUG_RE,
  isLightningAddress,
  recipientMatches,
} from "@agentic-bitcoin/core"
import type { SupabaseClient } from "@supabase/supabase-js"

type Row = {
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
  nwc_receive?: string | null
  submitted_at?: string | null
}
const toRow = (r: Recipient): Row => ({
  slug: r.slug,
  kind: r.kind,
  name: r.name,
  lightning_address: r.lightningAddress,
  verified_how: r.verified?.how ?? null,
  verified_at: r.verified?.at ?? null,
  website: r.website ?? null,
  country: r.country ?? null,
  description: r.description ?? null,
  owner_user_id: r.ownerUserId ?? null,
  nwc_receive: r.nwcReceive ?? null,
  submitted_at: r.submittedAt ?? null,
})
const fromRow = (x: Row): Recipient => ({
  slug: x.slug,
  kind: x.kind as Recipient["kind"],
  name: x.name,
  lightningAddress: x.lightning_address,
  verified:
    x.verified_how && x.verified_at
      ? { how: x.verified_how as "domain" | "operator", at: x.verified_at }
      : null,
  website: x.website ?? undefined,
  country: x.country ?? undefined,
  description: x.description ?? undefined,
  ownerUserId: x.owner_user_id ?? undefined,
  nwcReceive: x.nwc_receive ?? undefined,
  submittedAt: x.submitted_at ?? undefined,
})

export class SupabaseRecipientStore implements RecipientStore {
  readonly kind = "supabase"
  constructor(private readonly db: SupabaseClient) {}
  private async rows(userId?: string): Promise<Recipient[]> {
    let q = this.db.from("recipients").select("*")
    q = userId
      ? q.or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
      : q.is("owner_user_id", null)
    const { data, error } = await q
    if (error) throw new Error(`recipients read failed: ${error.message}`)
    return ((data ?? []) as Row[]).map(fromRow)
  }
  async get(slug: string, userId?: string) {
    const { data, error } = await this.db
      .from("recipients")
      .select("*")
      .eq("slug", slug.toLowerCase())
      .maybeSingle()
    if (error) throw new Error(`recipient read failed: ${error.message}`)
    if (!data) return null
    const r = fromRow(data as Row)
    return !r.ownerUserId || r.ownerUserId === userId ? r : null
  }
  async search(query: string, userId?: string) {
    return (await this.rows(userId)).filter((r) => recipientMatches(r, query))
  }
  async list(userId?: string) {
    return this.rows(userId)
  }
  async upsert(r: Recipient) {
    if (!SLUG_RE.test(r.slug)) throw new Error(`bad slug: ${r.slug}`)
    const { error } = await this.db.from("recipients").upsert(toRow(r))
    if (error) throw new Error(`recipient write failed: ${error.message}`)
  }
  async remove(slug: string) {
    const { error } = await this.db.from("recipients").delete().eq("slug", slug)
    if (error) throw new Error(`recipient delete failed: ${error.message}`)
  }
}

/** One entry of the operator's RECIPIENTS_FILE. `verified: true` means the operator vouches. */
export type SeedEntry = {
  slug: string
  kind: Recipient["kind"]
  name: string
  lightningAddress: string
  verified?: boolean
  website?: string
  country?: string
  description?: string
}

export function parseSeed(json: string): SeedEntry[] {
  const parsed = JSON.parse(json) as unknown
  if (!Array.isArray(parsed)) throw new Error("recipients file must be a JSON array")
  return parsed.map((e, i) => {
    const x = e as Partial<SeedEntry>
    if (!x.slug || !SLUG_RE.test(x.slug)) throw new Error(`entry ${i}: bad slug`)
    if (!x.kind || !RECIPIENT_KINDS.includes(x.kind))
      throw new Error(`entry ${i} (${x.slug}): bad kind`)
    if (!x.name?.trim()) throw new Error(`entry ${i} (${x.slug}): name required`)
    if (!x.lightningAddress || !isLightningAddress(x.lightningAddress))
      throw new Error(`entry ${i} (${x.slug}): bad lightning address`)
    return {
      slug: x.slug,
      kind: x.kind,
      name: x.name.trim(),
      lightningAddress: x.lightningAddress.trim().toLowerCase(),
      verified: x.verified === true,
      website: x.website,
      country: x.country,
      description: x.description,
    }
  })
}

/** Upsert the operator's directory. Existing private (owned) entries with the same slug are never overwritten. */
export async function seedRecipients(
  store: RecipientStore,
  path: string,
  now: () => Date = () => new Date(),
): Promise<number> {
  const entries = parseSeed(readFileSync(path, "utf8"))
  let n = 0
  for (const e of entries) {
    const existing = await store.get(e.slug)
    if (existing?.ownerUserId) continue
    await store.upsert({
      slug: e.slug,
      kind: e.kind,
      name: e.name,
      lightningAddress: e.lightningAddress,
      verified: e.verified
        ? (existing?.verified ?? { how: "operator", at: now().toISOString() })
        : null,
      website: e.website,
      country: e.country,
      description: e.description,
    })
    n++
  }
  return n
}
