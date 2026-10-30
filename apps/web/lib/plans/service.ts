/**
 * The shop plan (M24, ADR-0028). A merchant's plan is a pair of dates; the money is an ordinary
 * issued invoice from the operator's own recipient (`PLAN_PAYEE_SLUG`) to the merchant, paid at
 * /pay/<token> and settled there. This module creates plans lazily, issues the invoice, applies
 * paid ones (once), and answers "may this shop sell right now?".
 */
import {
  type InvoiceStore,
  type IssuedInvoice,
  type MerchantPlan,
  PLAN_INCLUDES,
  PLAN_LAPSE_KEEPS,
  PLAN_LAPSE_STOPS,
  type PlanState,
  type PlanStore,
  type PlanTerms,
  type Recipient,
  applyPlanPayment,
  invoiceStatus,
  newInvoiceToken,
  newPlan,
  planOk,
  planStatus,
  planTermsFromEnv,
  plansOn,
} from "@agentic-bitcoin/core"
import { hashToken } from "../receive/service"
import type { ReceiveStore } from "../receive/store"

export interface PlanDeps {
  plans: PlanStore
  invoices: InvoiceStore
  receive: ReceiveStore
  terms: PlanTerms
  baseUrl: string
  now?: () => Date
}
const nowOf = (d: PlanDeps) => (d.now ?? (() => new Date()))()
const memoFor = (slug: string) => `plan:${slug}`

export interface PlanView {
  state: PlanState
  until: string
  lapsesAt: string
  daysLeft: number
  priceCents: number
  pilotDays: number
  graceDays: number
  payee: { slug: string; name: string } | null
  /** The outstanding plan invoice, when one is open. */
  open: { number: string; link: string; totalCents: number; status: string } | null
  history: { number: string; paidAt: string; totalCents: number; link: string }[]
  includes: readonly string[]
  stops: readonly string[]
  keeps: readonly string[]
}

type Payer = Pick<Recipient, "slug" | "name" | "submittedAt" | "verified">

/** The plan row for a merchant, created on first sight: the pilot starts when they onboarded. */
async function ensurePlan(deps: PlanDeps, r: Payer): Promise<MerchantPlan> {
  const existing = await deps.plans.get(r.slug)
  if (existing) return existing
  const started = r.submittedAt ?? r.verified?.at
  const startedAt = started && !Number.isNaN(Date.parse(started)) ? new Date(started) : nowOf(deps)
  const p = newPlan(r.slug, startedAt, deps.terms)
  await deps.plans.upsert(p)
  return p
}

/** Fold a settled or voided open invoice into the plan. The pay page is where settlement is seen. */
async function reconcile(deps: PlanDeps, plan: MerchantPlan): Promise<MerchantPlan> {
  if (!plan.openInvoiceId) return plan
  const inv = await deps.invoices.get(plan.openInvoiceId)
  let next = plan
  if (!inv || inv.state === "void") next = { ...plan, openInvoiceId: undefined }
  else if (inv.state === "paid")
    next = applyPlanPayment(plan, inv.id, inv.paidAt ?? nowOf(deps).toISOString())
  if (next !== plan) await deps.plans.upsert({ ...next, updatedAt: nowOf(deps).toISOString() })
  return next
}

async function planInvoices(deps: PlanDeps, slug: string): Promise<IssuedInvoice[]> {
  if (!deps.terms.payeeSlug) return []
  const all = await deps.invoices.listForIssuer(`recipient:${deps.terms.payeeSlug}`, 1000)
  return all.filter((i) => i.memo === memoFor(slug))
}

export async function planFor(deps: PlanDeps, r: Payer): Promise<PlanView> {
  const now = nowOf(deps)
  const plan = await reconcile(deps, await ensurePlan(deps, r))
  const s = planStatus(plan, now, deps.terms)
  const payee =
    plansOn(deps.terms) && deps.terms.payeeSlug
      ? await deps.receive.getRecipient(deps.terms.payeeSlug)
      : null
  const link = (t: string) => `${deps.baseUrl.replace(/\/$/, "")}/pay/${t}`
  const open = plan.openInvoiceId ? await deps.invoices.get(plan.openInvoiceId) : null
  const history = (await planInvoices(deps, r.slug))
    .filter((i) => i.state === "paid")
    .sort((a, b) => ((a.paidAt ?? "") < (b.paidAt ?? "") ? 1 : -1))
    .map((i) => ({
      number: i.number,
      paidAt: i.paidAt ?? i.createdAt,
      totalCents: Number(i.totalCents),
      link: link(i.token),
    }))
  return {
    state: s.state,
    until: s.until,
    lapsesAt: s.lapsesAt,
    daysLeft: s.daysLeft,
    priceCents: Number(deps.terms.usdCents),
    pilotDays: deps.terms.pilotDays,
    graceDays: deps.terms.graceDays,
    payee: payee ? { slug: payee.slug, name: payee.name } : null,
    open:
      open && open.state === "open"
        ? {
            number: open.number,
            link: link(open.token),
            totalCents: Number(open.totalCents),
            status: invoiceStatus(open, now),
          }
        : null,
    history,
    includes: PLAN_INCLUDES,
    stops: PLAN_LAPSE_STOPS,
    keeps: PLAN_LAPSE_KEEPS,
  }
}

/**
 * "Pay now": the open plan invoice's link, issuing one if none is open. The invoice belongs to
 * the operator's recipient, is for one month, and names the merchant as payer. Needs the
 * merchant's own portal token.
 */
export async function requestPlanInvoice(
  deps: PlanDeps,
  slug: string,
  token: string,
): Promise<{ ok: true; link: string; number: string } | { ok: false; error: string }> {
  const r = await deps.receive.getRecipient(slug.toLowerCase())
  if (!r || !r.dashboardTokenHash || !token || hashToken(token) !== r.dashboardTokenHash)
    return { ok: false, error: "Not authorized." }
  if (!plansOn(deps.terms) || !deps.terms.payeeSlug)
    return { ok: false, error: "Plans are not switched on for this server; nothing to pay." }
  const payee = await deps.receive.getRecipient(deps.terms.payeeSlug)
  if (!payee) return { ok: false, error: "The operator has not set up a payee yet." }
  const now = nowOf(deps)
  const plan = await reconcile(deps, await ensurePlan(deps, r))
  const link = (t: string) => `${deps.baseUrl.replace(/\/$/, "")}/pay/${t}`
  if (plan.openInvoiceId) {
    const open = await deps.invoices.get(plan.openInvoiceId)
    if (open && open.state === "open")
      return { ok: true, link: link(open.token), number: open.number }
  }
  const issuer = `recipient:${payee.slug}`
  const inv: IssuedInvoice = {
    id: `inv_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    number: await deps.invoices.nextNumber(issuer),
    issuer,
    issuerName: payee.name,
    kind: "invoice",
    payerName: r.name,
    items: [
      {
        description: `Anvard shop plan, one month: ${r.name}`.slice(0, 120),
        qty: 1,
        unitCents: deps.terms.usdCents,
      },
    ],
    totalCents: deps.terms.usdCents,
    memo: memoFor(r.slug),
    dueAt: planStatus(plan, now, deps.terms).until,
    state: "open",
    token: newInvoiceToken(),
    createdAt: now.toISOString(),
  }
  await deps.invoices.create(inv)
  await deps.plans.upsert({ ...plan, openInvoiceId: inv.id, updatedAt: now.toISOString() })
  return { ok: true, link: link(inv.token), number: inv.number }
}

/** May this merchant sell right now? Unknown merchants start a pilot, so the answer is yes. */
export async function merchantMaySell(deps: PlanDeps, r: Payer): Promise<boolean> {
  if (!plansOn(deps.terms)) return true
  const plan = await reconcile(deps, await ensurePlan(deps, r))
  return planOk(planStatus(plan, nowOf(deps), deps.terms))
}

export const planTerms = (env = process.env) => planTermsFromEnv(env)
