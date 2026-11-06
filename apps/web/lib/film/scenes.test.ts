import { describe, expect, it } from "vitest"
import { SAMPLES, SCENES, SUNDAY, cardLimitSats, runtimeMs, spentSats } from "./scenes"

describe("film scenes", () => {
  it("Sunday spends what the card allows, and the closing line matches", () => {
    const limit = cardLimitSats(SUNDAY)
    expect(limit).toBe(180_000)
    expect(spentSats(SUNDAY)).toBe(134_050)
    expect(spentSats(SUNDAY)).toBeLessThan(limit as number)
    const last = SUNDAY.beats.filter((b) => b.kind === "bot").at(-1)
    expect(last?.kind === "bot" && last.text).toContain("134,050 sats")
    expect(last?.kind === "bot" && last.text).toContain(
      `${(180_000 - 134_050).toLocaleString("en-US")} sats`,
    )
  })

  it("Samples approves every order it places, and the sum in the summary is right", () => {
    const orders = SAMPLES.beats.filter((b) => b.kind === "order")
    const approved = SAMPLES.beats
      .filter((b) => b.kind === "approve")
      .map((b) => b.kind === "approve" && b.id)
    for (const o of orders)
      expect(o.kind === "order" && approved).toContain(o.kind === "order" && o.id)
    const total = orders.reduce((n, o) => n + (o.kind === "order" ? o.sats : 0), 0)
    const last = SAMPLES.beats.filter((b) => b.kind === "bot").at(-1)
    expect(last?.kind === "bot" && last.text).toContain(
      `${total.toLocaleString("en-US")} sats in all`,
    )
  })

  it("every scene ends with done, has a unique slug and runs under a minute", () => {
    const slugs = new Set(SCENES.map((s) => s.slug))
    expect(slugs.size).toBe(SCENES.length)
    for (const s of SCENES) {
      expect(s.beats.at(-1)?.kind).toBe("done")
      expect(runtimeMs(s)).toBeLessThan(60_000)
      expect(runtimeMs(s)).toBeGreaterThan(10_000)
    }
  })
})
