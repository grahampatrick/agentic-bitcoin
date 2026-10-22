import { createHash } from "node:crypto"
import { type CardStore, InMemoryCardStore, type VirtualCard } from "@agentic-bitcoin/core"
import { SupabaseCardStore } from "@agentic-bitcoin/stores"
import { createClient } from "@supabase/supabase-js"

/** Keyless demo (no database): one fictional card so /card/card_demo?t=demo shows the shape. */
const DEMO_CARD: VirtualCard = {
  id: "card_demo",
  userId: "demo",
  name: "Steam purchases",
  scope: ["product:steam", "merchant:bitrefill"],
  monthlyCapSats: 50_000n,
  confirmAboveSats: 10_000n,
  resetDay: 1,
  state: "active",
  createdAt: "2026-10-22T00:00:00.000Z",
  viewTokenHash: createHash("sha256").update("demo").digest("hex"),
  spentSats: 12_153n,
}

const g = globalThis as { __cards?: CardStore }
export function getCardStore(): CardStore {
  if (g.__cards) return g.__cards
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  g.__cards =
    url && key
      ? new SupabaseCardStore(createClient(url, key, { auth: { persistSession: false } }))
      : new InMemoryCardStore([DEMO_CARD])
  return g.__cards
}
