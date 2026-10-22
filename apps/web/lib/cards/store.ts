import { type CardStore, InMemoryCardStore } from "@agentic-bitcoin/core"
import { SupabaseCardStore } from "@agentic-bitcoin/stores"
import { createClient } from "@supabase/supabase-js"

const g = globalThis as { __cards?: CardStore }
export function getCardStore(): CardStore {
  if (g.__cards) return g.__cards
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  g.__cards =
    url && key
      ? new SupabaseCardStore(createClient(url, key, { auth: { persistSession: false } }))
      : new InMemoryCardStore()
  return g.__cards
}
