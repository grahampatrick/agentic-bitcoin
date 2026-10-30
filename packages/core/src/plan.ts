/**
 * The shop plan (M24, ADR-0028): what a merchant pays Anvard for its storefront, protocol endpoints,
 * importers and listing. Pure dates and rules. The money moves as an ordinary issued invoice from the
 * operator's own recipient to the merchant; this module only decides the state and the next date.
 */

export type PlanState = "free" | "pilot" | "active" | "due" | "lapsed"

export interface MerchantPlan {
  slug: string
  startedAt: string
  pilotEndsAt: string
  /** Set once a plan invoice has been paid; the plan is active until here. */
  paidThroughAt?: string
  /** The open plan invoice (an M14 IssuedInvoice id), if one is outstanding. */
  openInvoiceId?: string
  /** Invoice ids already applied, so a paid invoice never extends the plan twice. */
  appliedInvoiceIds: string[]
  updatedAt: string
}

export interface PlanTerms {
  /** Monthly price in US cents; 0 = plans off (everything free). */
  usdCents: bigint
  pilotDays: number
  graceDays: number
  /** The operator's own recipient slug; its wallet receives the plan. Unset = plans off. */
  payeeSlug?: string
}

export const DEFAULT_PLAN_TERMS: PlanTerms = { usdCents: 0n, pilotDays: 60, graceDays: 14 }

export function planTermsFromEnv(env: NodeJS.ProcessEnv = process.env): PlanTerms {
  const int = (v: string | undefined, d: number) => {
    const n = Number(v)
    return v !== undefined && v !== "" && Number.isInteger(n) && n >= 0 ? n : d
  }
  const cents = (env.PLAN_SHOP_USD_CENTS ?? "").trim()
  const payee = (env.PLAN_PAYEE_SLUG ?? "").trim().toLowerCase()
  return {
    usdCents: /^\d{1,9}$/.test(cents) ? BigInt(cents) : DEFAULT_PLAN_TERMS.usdCents,
    pilotDays: int(env.PLAN_PILOT_DAYS, DEFAULT_PLAN_TERMS.pilotDays),
    graceDays: int(env.PLAN_GRACE_DAYS, DEFAULT_PLAN_TERMS.graceDays),
    payeeSlug: /^[a-z0-9-]{2,63}$/.test(payee) ? payee : undefined,
  }
}

/** Plans charge only when there is a price and someone to pay. */
export function plansOn(terms: PlanTerms): boolean {
  return terms.usdCents > 0n && !!terms.payeeSlug
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()
}

/** Calendar month arithmetic that never skips: Jan 31 + 1 month = Feb 28/29. */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.toISOString()
}

export function newPlan(slug: string, startedAt: Date, terms: PlanTerms): MerchantPlan {
  const started = startedAt.toISOString()
  return {
    slug,
    startedAt: started,
    pilotEndsAt: addDays(started, terms.pilotDays),
    appliedInvoiceIds: [],
    updatedAt: started,
  }
}

/** The date the plan is good through: the later of the pilot end and the paid-through date. */
export function planUntil(plan: MerchantPlan): string {
  return plan.paidThroughAt && plan.paidThroughAt > plan.pilotEndsAt
    ? plan.paidThroughAt
    : plan.pilotEndsAt
}

export interface PlanStatus {
  state: PlanState
  until: string
  lapsesAt: string
  /** Whole days until `until` (negative once past it). */
  daysLeft: number
}

export function planStatus(plan: MerchantPlan, now: Date, terms: PlanTerms): PlanStatus {
  const until = planUntil(plan)
  const lapsesAt = addDays(until, terms.graceDays)
  const daysLeft = Math.floor((new Date(until).getTime() - now.getTime()) / 86_400_000)
  const iso = now.toISOString()
  if (!plansOn(terms)) return { state: "free", until, lapsesAt, daysLeft }
  if (iso < until)
    return {
      state: plan.paidThroughAt && plan.paidThroughAt > plan.pilotEndsAt ? "active" : "pilot",
      until,
      lapsesAt,
      daysLeft,
    }
  return { state: iso < lapsesAt ? "due" : "lapsed", until, lapsesAt, daysLeft }
}

/** Everything but `lapsed` keeps the storefront on. */
export function planOk(status: Pick<PlanStatus, "state">): boolean {
  return status.state !== "lapsed"
}

/**
 * A paid plan invoice extends the plan by one month from the later of the current paid-through
 * date and the payment day: paying early during the pilot starts the month after the pilot; paying
 * late starts it on the day. Applying the same invoice twice changes nothing.
 */
export function applyPlanPayment(
  plan: MerchantPlan,
  invoiceId: string,
  paidAt: string,
  months = 1,
): MerchantPlan {
  if (plan.appliedInvoiceIds.includes(invoiceId)) return plan
  const until = planUntil(plan)
  const base = until > paidAt ? until : paidAt
  return {
    ...plan,
    paidThroughAt: addMonths(base, months),
    openInvoiceId: plan.openInvoiceId === invoiceId ? undefined : plan.openInvoiceId,
    appliedInvoiceIds: [...plan.appliedInvoiceIds, invoiceId],
    updatedAt: paidAt,
  }
}

export const PLAN_INCLUDES = [
  "Your storefront on the site and in the directory",
  "Checkout paid straight into your wallet, never through ours",
  "The commerce protocol endpoints agents buy from",
  "Importers for your card-shop catalogue",
  "Orders, shipping details sealed for you alone, fulfilment notes",
] as const

export const PLAN_LAPSE_STOPS = [
  "Your products leave the shop and the directory",
  "Checkout refuses new orders",
] as const

export const PLAN_LAPSE_KEEPS = [
  "Your pay links, tips, invoices and campaigns keep working",
  "Paid orders stay yours to fulfil",
  "Paying any time turns everything back on",
] as const

export interface PlanStore {
  readonly kind: string
  get(slug: string): Promise<MerchantPlan | null>
  upsert(plan: MerchantPlan): Promise<void>
  list(): Promise<MerchantPlan[]>
}

export class InMemoryPlanStore implements PlanStore {
  readonly kind = "memory"
  readonly plans = new Map<string, MerchantPlan>()
  constructor(seed: readonly MerchantPlan[] = []) {
    for (const p of seed) this.plans.set(p.slug, p)
  }
  async get(slug: string): Promise<MerchantPlan | null> {
    return this.plans.get(slug) ?? null
  }
  async upsert(plan: MerchantPlan): Promise<void> {
    this.plans.set(plan.slug, { ...plan, appliedInvoiceIds: [...plan.appliedInvoiceIds] })
  }
  async list(): Promise<MerchantPlan[]> {
    return [...this.plans.values()]
  }
}
