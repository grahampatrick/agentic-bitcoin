import { getInvoiceStore } from "../invoices/store"
import { siteBaseUrl } from "../receive/service"
import { getReceiveStore } from "../receive/store"
import { type PlanDeps, planTerms } from "./service"
import { DEMO_PLAN_TERMS, getPlanStore } from "./store"

export function planDepsFor(req?: Request): PlanDeps {
  return {
    plans: getPlanStore(),
    invoices: getInvoiceStore(),
    receive: getReceiveStore(),
    // the keyless demo shows a pilot in progress; a real deploy charges nothing until configured
    terms: getPlanStore().kind === "memory" ? DEMO_PLAN_TERMS : planTerms(),
    baseUrl: siteBaseUrl(req),
  }
}
