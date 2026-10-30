import {
  InMemoryInvoiceStore,
  InMemoryPlanStore,
  type IssuedInvoice,
  type PlanTerms,
} from "@agentic-bitcoin/core"
import { describe, expect, it } from "vitest"
import { hashToken } from "../receive/service"
import { InMemoryReceiveStore } from "../receive/store"
import { merchantMaySell, planFor, requestPlanInvoice } from "./service"

const terms: PlanTerms = { usdCents: 2100n, pilotDays: 60, graceDays: 14, payeeSlug: "anvard" }

function world(now: string, t: PlanTerms = terms) {
  const receive = new InMemoryReceiveStore([
    {
      slug: "anvard",
      kind: "merchant",
      name: "Anvard",
      lightningAddress: "plans@anvard.example",
      verified: { how: "operator", at: "2026-01-01T00:00:00.000Z" },
    },
    {
      slug: "cards",
      kind: "merchant",
      name: "Cardboard Castle",
      lightningAddress: "pay@cards.example",
      verified: { how: "operator", at: "2026-09-01T00:00:00.000Z" },
      submittedAt: "2026-09-01T00:00:00.000Z",
      dashboardTokenHash: hashToken("tok"),
    },
  ])
  const invoices = new InMemoryInvoiceStore()
  const plans = new InMemoryPlanStore()
  const clock = { now }
  const deps = {
    plans,
    invoices,
    receive,
    terms: t,
    baseUrl: "https://x.example",
    now: () => new Date(clock.now),
  }
  return { deps, invoices, plans, receive, clock }
}

describe("the shop plan", () => {
  it("starts a pilot from onboarding on first sight, then falls due and lapses", async () => {
    const w = world("2026-09-10T00:00:00.000Z")
    const cards = (await w.receive.getRecipient("cards")) as NonNullable<
      Awaited<ReturnType<typeof w.receive.getRecipient>>
    >
    const v = await planFor(w.deps, cards)
    expect(v).toMatchObject({
      state: "pilot",
      until: "2026-10-31T00:00:00.000Z",
      daysLeft: 51,
      priceCents: 2100,
      payee: { slug: "anvard", name: "Anvard" },
      open: null,
      history: [],
    })
    expect(await w.plans.get("cards")).toMatchObject({ startedAt: "2026-09-01T00:00:00.000Z" })
    expect(await merchantMaySell(w.deps, cards)).toBe(true)
    w.clock.now = "2026-11-05T00:00:00.000Z"
    expect((await planFor(w.deps, cards)).state).toBe("due")
    expect(await merchantMaySell(w.deps, cards)).toBe(true)
    w.clock.now = "2026-11-20T00:00:00.000Z"
    expect((await planFor(w.deps, cards)).state).toBe("lapsed")
    expect(await merchantMaySell(w.deps, cards)).toBe(false)
  })

  it("issues one plan invoice from the payee, and a paid one extends the plan exactly once", async () => {
    const w = world("2026-11-05T00:00:00.000Z")
    expect(await requestPlanInvoice(w.deps, "cards", "wrong")).toMatchObject({ ok: false })
    const r1 = await requestPlanInvoice(w.deps, "cards", "tok")
    expect(r1).toMatchObject({ ok: true, number: "INV-0001" })
    const r2 = await requestPlanInvoice(w.deps, "cards", "tok")
    expect(r2).toEqual(r1) // the open one is reused
    const inv = (await w.invoices.listForIssuer("recipient:anvard"))[0] as IssuedInvoice
    expect(inv).toMatchObject({
      issuer: "recipient:anvard",
      issuerName: "Anvard",
      payerName: "Cardboard Castle",
      totalCents: 2100n,
      memo: "plan:cards",
      dueAt: "2026-10-31T00:00:00.000Z",
      state: "open",
    })
    expect((r1 as { link: string }).link).toBe(`https://x.example/pay/${inv.token}`)
    const cards = (await w.receive.getRecipient("cards")) as NonNullable<
      Awaited<ReturnType<typeof w.receive.getRecipient>>
    >
    expect((await planFor(w.deps, cards)).open).toMatchObject({
      number: "INV-0001",
      status: "overdue",
    })

    // the pay page marks it paid; the next portal load applies it
    await w.invoices.update({ ...inv, state: "paid", paidAt: "2026-11-06T00:00:00.000Z" })
    const paid = await planFor(w.deps, cards)
    expect(paid).toMatchObject({
      state: "active",
      until: "2026-12-06T00:00:00.000Z",
      open: null,
    })
    expect(paid.history).toEqual([
      {
        number: "INV-0001",
        paidAt: "2026-11-06T00:00:00.000Z",
        totalCents: 2100,
        link: `https://x.example/pay/${inv.token}`,
      },
    ])
    expect((await planFor(w.deps, cards)).until).toBe("2026-12-06T00:00:00.000Z")
    expect(await merchantMaySell(w.deps, cards)).toBe(true)
    // a voided open invoice is dropped
    const r3 = await requestPlanInvoice(w.deps, "cards", "tok")
    const inv2 = await w.invoices.get((await w.plans.get("cards"))?.openInvoiceId as string)
    expect(r3).toMatchObject({ ok: true, number: "INV-0002" })
    await w.invoices.update({ ...(inv2 as NonNullable<typeof inv2>), state: "void" })
    expect((await planFor(w.deps, cards)).open).toBeNull()
  })

  it("is free when plans are off: nothing to pay, everyone may sell", async () => {
    const w = world("2027-06-01T00:00:00.000Z", { ...terms, payeeSlug: undefined })
    const cards = (await w.receive.getRecipient("cards")) as NonNullable<
      Awaited<ReturnType<typeof w.receive.getRecipient>>
    >
    expect((await planFor(w.deps, cards)).state).toBe("free")
    expect(await merchantMaySell(w.deps, cards)).toBe(true)
    expect(await requestPlanInvoice(w.deps, "cards", "tok")).toMatchObject({
      ok: false,
      error: /not switched on/,
    })
  })
})
