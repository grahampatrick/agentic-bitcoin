import { InMemoryPlanStore, type PlanStore, type PlanTerms, newPlan } from "@agentic-bitcoin/core"
import { SupabasePlanStore } from "@agentic-bitcoin/stores"
import { createClient } from "@supabase/supabase-js"

const g = globalThis as { __plans?: PlanStore }

/** The keyless demo merchant is three weeks into its pilot, on the default terms. */
export const DEMO_PLAN_START = new Date("2026-10-20T00:00:00.000Z")
export const DEMO_PLAN_TERMS: PlanTerms = {
  usdCents: 2100n,
  pilotDays: 60,
  graceDays: 14,
  payeeSlug: "anvard",
}

export function getPlanStore(): PlanStore {
  if (g.__plans) return g.__plans
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  g.__plans =
    url && key
      ? new SupabasePlanStore(createClient(url, key, { auth: { persistSession: false } }))
      : new InMemoryPlanStore([newPlan("cardboard-castle", DEMO_PLAN_START, DEMO_PLAN_TERMS)])
  return g.__plans
}

export function __setPlanStore(s: PlanStore | null): void {
  g.__plans = s ?? undefined
}
