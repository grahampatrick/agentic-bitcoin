import { CAMPAIGNS, PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import {
  type Campaign,
  type Contribution,
  InMemoryCampaignStore,
  campaignProgress,
} from "./campaign"
import { centsToSats } from "./money"

const well: Campaign = CAMPAIGNS.well
const support: Campaign = CAMPAIGNS.ortizSupport
const sats = (c: bigint) => centsToSats(c, PRICE)

describe("campaignProgress", () => {
  it("dedupes by payment hash across sources and counts supporters by key", () => {
    const cs: Contribution[] = [
      {
        campaignSlug: "grace-well",
        paymentHash: "AA",
        amountMsats: 1_000_000n,
        at: "2026-10-01T00:00:00Z",
        source: "chat",
        supporterKey: "s1",
      },
      {
        campaignSlug: "grace-well",
        paymentHash: "aa",
        amountMsats: 1_000_000n,
        at: "2026-10-01T00:00:01Z",
        source: "web",
      }, // same gift seen via LNURL
      {
        campaignSlug: "grace-well",
        paymentHash: "bb",
        amountMsats: 2_000_000n,
        at: "2026-10-02T00:00:00Z",
        source: "web",
      },
      {
        campaignSlug: "grace-well",
        amountMsats: 7_000_000n,
        at: "2026-10-03T00:00:00Z",
        source: "reported",
      },
      {
        campaignSlug: "grace-well",
        paymentHash: "cc",
        amountMsats: 500_000n,
        at: "2026-10-04T00:00:00Z",
        source: "chat",
        supporterKey: "s1",
      },
    ]
    const p = campaignProgress(well, cs, [])
    expect(p.raisedSats).toBe(10_500n)
    expect(p.contributions).toBe(4)
    expect(p.supporters).toBe(3) // s1, anon bb, anon reported
    expect(p.percent).toBe(0) // 10,500 of 20,000,000
    expect(p.goalLabel).toBe("20,000,000 sats")
  })
  it("a monthly goal is measured by pledged run-rate, priced for USD pledges", () => {
    const p = campaignProgress(
      support,
      [],
      [
        {
          scheduleId: "a",
          campaignSlug: support.slug,
          supporterKey: "s1",
          amountSats: 0n,
          usdCents: 2_500n,
          cron: "0 14 1 * *",
          active: true,
        },
        {
          scheduleId: "b",
          campaignSlug: support.slug,
          supporterKey: "s2",
          amountSats: 10_000n,
          cron: "0 14 * * 0",
          active: true,
        },
        {
          scheduleId: "c",
          campaignSlug: support.slug,
          supporterKey: "s3",
          amountSats: 99_000n,
          cron: "0 14 1 * *",
          active: false,
        },
      ],
      { satsPerUsdCent: sats },
    )
    expect(p.pledges).toBe(2)
    expect(p.pledgedMonthlySats).toBe(sats(2_500n) + 40_000n)
    expect(p.goalLabel).toBe("$1200/month")
    expect(p.percent).toBe(Number(((sats(2_500n) + 40_000n) * 100n) / sats(120_000n)))
    expect(campaignProgress(support, [], []).percent).toBeNull()
  })
  it("the memory store is idempotent on payment hash", async () => {
    const s = new InMemoryCampaignStore([well])
    await s.addContribution({
      campaignSlug: "grace-well",
      paymentHash: "x",
      amountMsats: 1n,
      at: "t",
      source: "chat",
    })
    await s.addContribution({
      campaignSlug: "grace-well",
      paymentHash: "x",
      amountMsats: 1n,
      at: "t",
      source: "web",
    })
    await s.addContribution({
      campaignSlug: "grace-well",
      amountMsats: 1n,
      at: "t",
      source: "reported",
    })
    expect(await s.contributions("grace-well")).toHaveLength(2)
    await s.follow("grace-well", "u1")
    expect(await s.followers("grace-well")).toEqual(["u1"])
    expect(await s.following("u1")).toEqual(["grace-well"])
    await s.unfollow("grace-well", "u1")
    expect(await s.followers("grace-well")).toEqual([])
  })
})
