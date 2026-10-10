import { InMemoryCampaignStore } from "@agentic-bitcoin/core"
import { CAMPAIGNS, PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { hashToken } from "../receive/service"
import { InMemoryReceiveStore } from "../receive/store"
import { campaignView, createCampaign, postUpdate, reportGift } from "./service"

const now = () => new Date("2026-10-10T12:00:00.000Z")
function world() {
  const receive = new InMemoryReceiveStore([
    {
      slug: "ortiz-family",
      kind: "missionary",
      name: "The Ortiz Family",
      lightningAddress: "ortiz-family@x.example",
      verified: { how: "operator", at: "t" },
      dashboardTokenHash: hashToken("tok"),
    },
    {
      slug: "grace-fellowship",
      kind: "church",
      name: "Grace",
      lightningAddress: "give@grace.example",
      verified: { how: "domain", at: "t" },
      dashboardTokenHash: hashToken("tok2"),
    },
  ])
  const campaigns = new InMemoryCampaignStore(Object.values(CAMPAIGNS))
  return { receive, campaigns, deps: { receive, campaigns, price: PRICE, now } }
}

describe("campaign view", () => {
  it("counts settled web invoices tagged with the campaign once, alongside recorded contributions", async () => {
    const w = world()
    await w.receive.recordInvoice({
      paymentHash: "h1",
      slug: "ortiz-family",
      amountMsats: 2_000_000,
      source: "nwc",
      createdAt: "2026-10-01T00:00:00Z",
      campaignSlug: "ortiz-field-support",
    })
    await w.receive.markSettled("h1", "2026-10-01T00:01:00Z", "p")
    await w.receive.recordInvoice({
      paymentHash: "h2",
      slug: "ortiz-family",
      amountMsats: 9_000_000,
      source: "nwc",
      createdAt: "2026-10-01T00:00:00Z",
      campaignSlug: "ortiz-field-support",
    })
    await w.campaigns.addContribution({
      campaignSlug: "ortiz-field-support",
      paymentHash: "H1",
      amountMsats: 2_000_000n,
      at: "2026-10-01T00:00:00Z",
      source: "chat",
      supporterKey: "s1",
      supporterName: "Graham",
    })
    await w.campaigns.addContribution({
      campaignSlug: "ortiz-field-support",
      paymentHash: "h3",
      amountMsats: 1_000_000n,
      at: "2026-10-02T00:00:00Z",
      source: "chat",
      supporterKey: "s2",
    })
    const v = await campaignView(w.deps, "ortiz-field-support")
    expect(v?.progress.raisedSats).toBe(3_000n)
    expect(v?.progress.contributions).toBe(2)
    expect(v?.progress.supporters).toBe(2)
    expect(v?.supporterNames).toEqual(["Graham"])
    expect(await campaignView(w.deps, "nope")).toBeNull()
  })
})

describe("dashboard actions", () => {
  it("creates a campaign (unique slug), posts updates and records reported gifts, only with the right token", async () => {
    const w = world()
    expect(
      await createCampaign(w.deps, "ortiz-family", "wrong", {
        title: "X",
        goalKind: "monthly",
        goalAmount: "100",
      }),
    ).toMatchObject({ ok: false })
    const c1 = await createCampaign(w.deps, "ortiz-family", "tok", {
      title: "Field support",
      story: " For Lima. ",
      goalKind: "monthly",
      goalAmount: "1,200",
    })
    expect(c1).toEqual({ ok: true, slug: "ortiz-family-field-support" })
    const c2 = await createCampaign(w.deps, "ortiz-family", "tok", {
      title: "Field support",
      goalKind: "total",
      goalAmount: "20000000",
    })
    expect(c2).toEqual({ ok: true, slug: "ortiz-family-field-support-2" })
    expect((await w.campaigns.get("ortiz-family-field-support"))?.goal).toEqual({
      usdCentsPerMonth: 120_000n,
    })
    expect((await w.campaigns.get("ortiz-family-field-support-2"))?.goal).toEqual({
      satsTotal: 20_000_000n,
    })
    expect(
      await createCampaign(w.deps, "ortiz-family", "tok", {
        title: "Bad",
        goalKind: "monthly",
        goalAmount: "abc",
      }),
    ).toMatchObject({ ok: false })

    expect(
      await postUpdate(
        w.deps,
        "ortiz-family",
        "tok",
        "ortiz-family-field-support",
        "Water at 40m.",
      ),
    ).toMatchObject({ ok: true })
    expect((await w.campaigns.updates("ortiz-family-field-support"))[0]?.text).toBe("Water at 40m.")
    expect(
      await postUpdate(w.deps, "grace-fellowship", "tok2", "ortiz-family-field-support", "hi"),
    ).toMatchObject({ ok: false })

    expect(
      await reportGift(
        w.deps,
        "ortiz-family",
        "tok",
        "ortiz-family-field-support",
        "50,000",
        "2026-09-01",
      ),
    ).toEqual({ ok: true })
    const v = await campaignView(w.deps, "ortiz-family-field-support")
    expect(v?.progress.raisedSats).toBe(50_000n)
    expect((await w.campaigns.contributions("ortiz-family-field-support"))[0]?.source).toBe(
      "reported",
    )
  })
})
