import { InMemoryCampaignStore } from "@agentic-bitcoin/core"
import { CAMPAIGNS } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { deliverCampaignUpdates } from "./campaigns"

describe("deliverCampaignUpdates", () => {
  it("sends each follower the updates they have not seen, once, and never to non-followers", async () => {
    const base = new InMemoryCampaignStore(Object.values(CAMPAIGNS))
    const markers = new Map<string, string>()
    const store = Object.assign(base, {
      lastDelivered: (c: string, u: string) => markers.get(`${c}|${u}`) ?? null,
      markDelivered: (c: string, u: string, at: string) => {
        markers.set(`${c}|${u}`, at)
      },
    })
    const sent: { u: string; text: string }[] = []
    const send = async (u: string, text: string) => {
      sent.push({ u, text })
    }
    await store.follow("grace-well", "u1")
    expect(await deliverCampaignUpdates(store, send)).toBe(0)
    await store.addUpdate({
      id: "1",
      campaignSlug: "grace-well",
      at: "2026-10-10T10:00:00Z",
      text: "Drilling\u0000 started.",
    })
    await store.addUpdate({
      id: "2",
      campaignSlug: "grace-well",
      at: "2026-10-11T10:00:00Z",
      text: "Water at 40m.",
    })
    expect(await deliverCampaignUpdates(store, send, { siteUrl: "https://x.example" })).toBe(1)
    expect(sent[0]?.u).toBe("u1")
    expect(sent[0]?.text).toContain("• 2026-10-10: Drilling  started.")
    expect(sent[0]?.text).toContain("• 2026-10-11: Water at 40m.")
    expect(sent[0]?.text).toContain("https://x.example/campaigns/grace-well")
    expect(await deliverCampaignUpdates(store, send)).toBe(0) // nothing new
    await store.addUpdate({
      id: "3",
      campaignSlug: "grace-well",
      at: "2026-10-12T10:00:00Z",
      text: "Pump installed.",
    })
    expect(await deliverCampaignUpdates(store, send)).toBe(1)
    expect(sent[1]?.text).not.toContain("Water at 40m")
    expect(sent).toHaveLength(2)
  })
})
