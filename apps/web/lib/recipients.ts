/**
 * The public giving directory (M9): verified recipients with no owner, read from Supabase when
 * configured. Without a database the directory is empty and the page says so — no made-up entries.
 */
import { createClient } from "@supabase/supabase-js"

export type DirectoryEntry = {
  slug: string
  kind: "church" | "missionary" | "creator" | "merchant"
  name: string
  lightningAddress: string
  verifiedHow: "domain" | "operator"
  website?: string
  country?: string
  description?: string
}

export async function loadDirectory(): Promise<DirectoryEntry[] | null> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  const db = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await db
    .from("recipients")
    .select("slug,kind,name,lightning_address,verified_how,website,country,description")
    .is("owner_user_id", null)
    .not("verified_how", "is", null)
    .order("kind")
    .order("name")
  if (error) {
    console.error("[give] directory read failed:", error.message)
    return null
  }
  return (data ?? []).map((r) => ({
    slug: r.slug as string,
    kind: r.kind as DirectoryEntry["kind"],
    name: r.name as string,
    lightningAddress: r.lightning_address as string,
    verifiedHow: r.verified_how as DirectoryEntry["verifiedHow"],
    website: (r.website as string | null) ?? undefined,
    country: (r.country as string | null) ?? undefined,
    description: (r.description as string | null) ?? undefined,
  }))
}

export const KIND_LABEL: Record<DirectoryEntry["kind"], string> = {
  church: "Churches",
  missionary: "Missionaries",
  creator: "Creators",
  merchant: "Merchants",
}
