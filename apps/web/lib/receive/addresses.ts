import { InMemoryLightningAddressStore, type LightningAddressStore } from "@agentic-bitcoin/core"
import { SupabaseLightningAddressStore } from "@agentic-bitcoin/stores"
import { createClient } from "@supabase/supabase-js"

const g = globalThis as { __lnAddresses?: LightningAddressStore }
export function getAddressStore(): LightningAddressStore {
  if (g.__lnAddresses) return g.__lnAddresses
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  g.__lnAddresses =
    url && key
      ? new SupabaseLightningAddressStore(
          createClient(url, key, { auth: { persistSession: false } }),
        )
      : new InMemoryLightningAddressStore()
  return g.__lnAddresses
}
