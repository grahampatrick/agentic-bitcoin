/**
 * Storefront stores for the web (M12): Supabase when configured, else the demo catalogue in memory
 * (shared across dev route modules on globalThis). Merchants come from the receive store.
 */
import {
  DEFAULT_REWARD_RATES,
  InMemoryOrderStore,
  InMemoryProductStore,
  InMemoryRewardStore,
  type OrderStore,
  type ProductStore,
  type RewardSink,
  type RewardStore,
  rewardSink,
} from "@agentic-bitcoin/core"
import {
  SupabaseOrderStore,
  SupabaseProductStore,
  SupabaseRewardStore,
} from "@agentic-bitcoin/stores"
import { createClient } from "@supabase/supabase-js"
import { InMemoryReceiveStore, getReceiveStore } from "../receive/store"
import { DEMO_MERCHANTS, DEMO_PRODUCTS } from "./demo"

const g = globalThis as {
  __shopProducts?: ProductStore
  __shopOrders?: OrderStore
  __shopRewards?: RewardStore
  __shopDemoSeeded?: boolean
}

export function isDemoCatalogue(): boolean {
  return !(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function db() {
  return createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    {
      auth: { persistSession: false },
    },
  )
}

export function getProductStore(): ProductStore {
  if (g.__shopProducts) return g.__shopProducts
  if (!isDemoCatalogue()) g.__shopProducts = new SupabaseProductStore(db())
  else {
    g.__shopProducts = new InMemoryProductStore(DEMO_PRODUCTS)
    seedDemoMerchants()
  }
  return g.__shopProducts
}

export function getOrderStore(): OrderStore {
  if (g.__shopOrders) return g.__shopOrders
  g.__shopOrders = isDemoCatalogue() ? new InMemoryOrderStore() : new SupabaseOrderStore(db())
  return g.__shopOrders
}

/** Demo merchants must exist as recipients so checkout can find their wallets. */
function seedDemoMerchants() {
  if (g.__shopDemoSeeded) return
  const r = getReceiveStore()
  if (r instanceof InMemoryReceiveStore) {
    for (const m of DEMO_MERCHANTS) if (!r.recipients.has(m.slug)) r.recipients.set(m.slug, m)
  }
  g.__shopDemoSeeded = true
}

export function __setShopStores(products: ProductStore | null, orders: OrderStore | null): void {
  g.__shopProducts = products ?? undefined
  g.__shopOrders = orders ?? undefined
}

export function getRewardStore(): RewardStore {
  if (g.__shopRewards) return g.__shopRewards
  g.__shopRewards = isDemoCatalogue() ? new InMemoryRewardStore() : new SupabaseRewardStore(db())
  return g.__shopRewards
}
let rewardSeq = 0
export function rewardSinkFor(): RewardSink {
  const bps = Number(process.env.REWARDS_BPS_DIRECTORY ?? DEFAULT_REWARD_RATES.bps.directory)
  return rewardSink(
    getRewardStore(),
    { ...DEFAULT_REWARD_RATES, bps: { ...DEFAULT_REWARD_RATES.bps, directory: bps } },
    () => `rw_${Date.now().toString(36)}_${(++rewardSeq).toString(36)}`,
  )
}
