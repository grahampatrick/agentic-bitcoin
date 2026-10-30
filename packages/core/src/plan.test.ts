import { describe, expect, it } from "vitest"
import {
  InMemoryPlanStore,
  type PlanTerms,
  addMonths,
  applyPlanPayment,
  newPlan,
  planOk,
  planStatus,
  planTermsFromEnv,
  plansOn,
} from "./plan"

const terms: PlanTerms = { usdCents: 2100n, pilotDays: 60, graceDays: 14, payeeSlug: "anvard" }
const t0 = new Date("2026-10-01T00:00:00.000Z")

describe("plan terms", () => {
  it("reads the env with defaults, and is off without a price or a payee", () => {
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv
    expect(planTermsFromEnv(env({}))).toEqual({
      usdCents: 0n,
      pilotDays: 60,
      graceDays: 14,
      payeeSlug: undefined,
    })
    const t = planTermsFromEnv(
      env({ PLAN_SHOP_USD_CENTS: "2100", PLAN_PILOT_DAYS: "30", PLAN_PAYEE_SLUG: "Anvard" }),
    )
    expect(t).toEqual({ usdCents: 2100n, pilotDays: 30, graceDays: 14, payeeSlug: "anvard" })
    expect(plansOn(t)).toBe(true)
    expect(plansOn({ ...t, payeeSlug: undefined })).toBe(false)
    expect(plansOn({ ...t, usdCents: 0n })).toBe(false)
    expect(
      planTermsFromEnv(env({ PLAN_SHOP_USD_CENTS: "-5", PLAN_PILOT_DAYS: "x" })).pilotDays,
    ).toBe(60)
  })

  it("adds calendar months without skipping", () => {
    expect(addMonths("2026-01-31T10:00:00.000Z", 1)).toBe("2026-02-28T10:00:00.000Z")
    expect(addMonths("2026-12-15T00:00:00.000Z", 1)).toBe("2027-01-15T00:00:00.000Z")
    expect(addMonths("2028-01-31T00:00:00.000Z", 1)).toBe("2028-02-29T00:00:00.000Z")
  })
})

describe("plan status", () => {
  it("walks pilot → due → lapsed, and is free when plans are off", () => {
    const p = newPlan("cards", t0, terms)
    expect(p.pilotEndsAt).toBe("2026-11-30T00:00:00.000Z")
    const at = (iso: string) => planStatus(p, new Date(iso), terms)
    expect(at("2026-10-15T00:00:00.000Z")).toMatchObject({ state: "pilot", daysLeft: 46 })
    expect(at("2026-11-30T00:00:00.000Z").state).toBe("due")
    expect(at("2026-12-13T23:59:59.000Z").state).toBe("due")
    expect(at("2026-12-14T00:00:00.000Z")).toMatchObject({
      state: "lapsed",
      lapsesAt: "2026-12-14T00:00:00.000Z",
    })
    expect(planOk(at("2026-12-13T00:00:00.000Z"))).toBe(true)
    expect(planOk(at("2026-12-14T00:00:00.000Z"))).toBe(false)
    expect(
      planStatus(p, new Date("2027-06-01T00:00:00.000Z"), { ...terms, usdCents: 0n }).state,
    ).toBe("free")
  })

  it("a payment extends one month from the later of paid-through and the payment day, once", () => {
    const p = newPlan("cards", t0, terms)
    // paid early, during the pilot: the month starts when the pilot ends
    const early = applyPlanPayment(
      { ...p, openInvoiceId: "inv_1" },
      "inv_1",
      "2026-10-20T00:00:00.000Z",
    )
    expect(early.paidThroughAt).toBe("2026-12-30T00:00:00.000Z")
    expect(early.openInvoiceId).toBeUndefined()
    expect(planStatus(early, new Date("2026-12-01T00:00:00.000Z"), terms).state).toBe("active")
    expect(applyPlanPayment(early, "inv_1", "2026-12-01T00:00:00.000Z")).toBe(early)
    // paid late, after lapsing: the month starts on the day
    const late = applyPlanPayment(early, "inv_2", "2027-03-05T00:00:00.000Z")
    expect(late.paidThroughAt).toBe("2027-04-05T00:00:00.000Z")
    expect(late.appliedInvoiceIds).toEqual(["inv_1", "inv_2"])
    expect(planStatus(late, new Date("2027-03-06T00:00:00.000Z"), terms).state).toBe("active")
  })

  it("the in-memory store copies what it keeps", async () => {
    const s = new InMemoryPlanStore()
    const p = newPlan("cards", t0, terms)
    await s.upsert(p)
    p.appliedInvoiceIds.push("x")
    expect((await s.get("cards"))?.appliedInvoiceIds).toEqual([])
    expect(await s.get("nope")).toBeNull()
    expect((await s.list()).length).toBe(1)
  })
})
