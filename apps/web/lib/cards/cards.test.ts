import { InMemoryCardStore, claimCard } from "@agentic-bitcoin/core"
import { describe, expect, it } from "vitest"
import { cardPage, createCardFromWeb, hashToken, setCardState } from "./service"

const now = new Date("2026-10-27T12:00:00.000Z")
let n = 0
const random = () => `r${++n}`

describe("cards made from the store", () => {
  it("creates an unowned card with a one-time link, then the page and claim work with that token", async () => {
    const store = new InMemoryCardStore()
    const r = await createCardFromWeb(
      store,
      {
        name: "Steam purchases",
        scope: ["product:steam", "merchant:bitrefill"],
        monthlyCapSats: "50,000",
        confirmAboveSats: "10000",
        resetDay: "1",
      },
      "https://anvard.example/",
      now,
      random,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link).toBe(`https://anvard.example/card/${r.id}?t=${r.token}`)
    const page = await cardPage(store, r.id, r.token, now)
    expect(page).toMatchObject({
      canManage: true,
      unclaimed: true,
      monthlyCapSats: 50_000n,
      confirmAboveSats: 10_000n,
      scope: ["product:steam", "merchant:bitrefill"],
    })
    expect((await cardPage(store, r.id, "nope", now))?.canManage).toBe(false)
    expect((await setCardState(store, r.id, r.token, "pause")).ok).toBe(true)
    const claimed = await claimCard(store, r.id, hashToken(r.token), "signal:+1")
    expect(claimed.ok).toBe(true)
    expect((await cardPage(store, r.id, r.token, now))?.unclaimed).toBe(false)
    expect((await store.listForUser("signal:+1"))[0]?.state).toBe("paused")
  })
  it("refuses bad input with a sentence, never a throw", async () => {
    const store = new InMemoryCardStore()
    const mk = (f: Parameters<typeof createCardFromWeb>[1]) =>
      createCardFromWeb(store, f, "https://x", now, random)
    expect(await mk({ name: " ", scope: "product:steam", monthlyCapSats: "1000" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("name"),
    })
    expect(await mk({ name: "Ok", scope: "", monthlyCapSats: "1000" })).toMatchObject({ ok: false })
    expect(await mk({ name: "Ok", scope: "*", monthlyCapSats: "" })).toMatchObject({
      ok: false,
      error: "Give the card a monthly limit in sats.",
    })
    expect(await mk({ name: "Ok", scope: "*", monthlyCapSats: "12.5" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("whole number"),
    })
    expect(await mk({ name: "Ok", scope: "rail:bogus", monthlyCapSats: "10" })).toMatchObject({
      ok: false,
    })
    expect((await mk({ name: "Ok", scope: "*", monthlyCapSats: "10", resetDay: "40" })).ok).toBe(
      true,
    )
  })
})
