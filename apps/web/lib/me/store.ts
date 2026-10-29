/**
 * The stores the workspace reads (M23, ADR-0027). Supabase when configured (the same rows the bot
 * writes); otherwise a keyless demo so /me?t=demo shows the shape on a fresh deploy.
 */
import {
  DEFAULT_POLICY,
  InMemoryLightningAddressStore,
  InMemoryPolicyStore,
  InMemoryReferralStore,
  InMemoryRewardStore,
  InMemorySecretStore,
  InMemoryWebLinkStore,
  type LightningAddressStore,
  type PolicyStore,
  type ReferralStore,
  type RewardStore,
  type SecretStore,
  type WebLinkStore,
  hashWebToken,
} from "@agentic-bitcoin/core"
import {
  SupabaseLightningAddressStore,
  SupabasePolicyStore,
  SupabaseReferralStore,
  SupabaseRewardStore,
  SupabaseSecretStore,
  SupabaseWebLinkStore,
} from "@agentic-bitcoin/stores"
import { createClient } from "@supabase/supabase-js"

export interface MeStores {
  policies: PolicyStore
  secrets: SecretStore
  webLinks: WebLinkStore
  addresses: LightningAddressStore
  referrals: ReferralStore
  rewards: RewardStore
  /** True when nothing is durable: the fictional "demo" account is the only one. */
  demo: boolean
}

export const DEMO_USER = "demo"
export const DEMO_TOKEN = "demo"

async function seedDemo(s: MeStores): Promise<void> {
  await s.webLinks.create({
    tokenHash: hashWebToken(DEMO_TOKEN),
    userId: DEMO_USER,
    createdAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
  })
  await s.policies.set(DEMO_USER, {
    ...DEFAULT_POLICY,
    rails: { ...DEFAULT_POLICY.rails, exchange: true },
    allowDestinations: [],
    denyDestinations: ["*.sweepstakes.example"],
    coldStorageAddresses: ["bc1qdemo0000000000000000000000000000000000"],
  })
  // presence only: the blobs are meaningless here and never decrypted on the web
  await s.secrets.set(DEMO_USER, "nwc", "sealed:demo")
  await s.secrets.set(DEMO_USER, "strike", "sealed:demo")
  await s.addresses.create({
    name: "demo",
    userId: DEMO_USER,
    nwcSealed: "sealed:demo",
    createdAt: "2026-10-22T00:00:00.000Z",
  })
  const code = await s.referrals.codeFor(DEMO_USER)
  await s.referrals.create({
    id: "rf_demo1",
    code,
    referrerId: DEMO_USER,
    friendId: "signal:+15550000101",
    joinedAt: "2026-10-24T15:00:00.000Z",
    qualifiedAt: "2026-10-25T09:30:00.000Z",
    qualifyingEntryId: "act_demo_q",
    qualifyingSats: 2_500n,
    rewardIds: ["rw_demo_ref1"],
  })
  await s.referrals.create({
    id: "rf_demo2",
    code,
    referrerId: DEMO_USER,
    friendId: "signal:+15550000102",
    joinedAt: "2026-10-28T18:00:00.000Z",
    rewardIds: [],
  })
  await s.rewards.create({
    id: "rw_demo_ref1",
    userId: DEMO_USER,
    source: "referral",
    orderId: "ref:rf_demo1:referrer",
    purchaseSats: 2_500n,
    amountSats: 1_000n,
    bps: 0,
    state: "payable",
    createdAt: "2026-10-25T09:30:00.000Z",
    payableAt: "2026-10-25T09:30:00.000Z",
  })
  await s.rewards.create({
    id: "rw_demo_shop",
    userId: DEMO_USER,
    source: "directory",
    merchantSlug: "cardboard-castle",
    orderId: "ord_demo_1",
    purchaseSats: 120_000n,
    amountSats: 1_200n,
    bps: 100,
    state: "paid",
    createdAt: "2026-10-12T00:00:00.000Z",
    payableAt: "2026-10-26T00:00:00.000Z",
  })
}

// On globalThis: Next dev gives every route its own module instance (see lib/receive/store.ts).
const g = globalThis as { __me?: MeStores; __meSeeded?: Promise<void> }

export function getMeStores(): MeStores {
  if (g.__me) return g.__me
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    const db = createClient(url, key, { auth: { persistSession: false } })
    g.__me = {
      policies: new SupabasePolicyStore(db),
      secrets: new SupabaseSecretStore(db),
      webLinks: new SupabaseWebLinkStore(db),
      addresses: new SupabaseLightningAddressStore(db),
      referrals: new SupabaseReferralStore(db),
      rewards: new SupabaseRewardStore(db),
      demo: false,
    }
    return g.__me
  }
  let seed = 7
  const nextByte = () => {
    seed = (seed * 31 + 11) % 224
    return seed
  }
  g.__me = {
    policies: new InMemoryPolicyStore(),
    secrets: new InMemorySecretStore(),
    webLinks: new InMemoryWebLinkStore(),
    addresses: new InMemoryLightningAddressStore(),
    referrals: new InMemoryReferralStore(nextByte),
    rewards: new InMemoryRewardStore(),
    demo: true,
  }
  g.__meSeeded = seedDemo(g.__me)
  return g.__me
}

/** Resolves once the keyless demo is seeded (immediately with a database). */
export async function meStoresReady(): Promise<MeStores> {
  const s = getMeStores()
  await g.__meSeeded
  return s
}
