import { InMemoryCardStore } from "@agentic-bitcoin/core"
import { describe, expect, it } from "vitest"
import { cardPage, hashToken, setCardState } from "./service"

describe("card page", () => {
  const store = new InMemoryCardStore([
    {
      id: "card_1",
      userId: "u",
      name: "Steam",
      scope: ["product:steam"],
      monthlyCapSats: 50_000n,
      resetDay: 1,
      state: "active",
      createdAt: "2026-10-01T00:00:00.000Z",
      viewTokenHash: hashToken("tok"),
      spentSats: 12_000n,
    },
  ])
  it("shows numbers only with the right token, and pauses/resumes with it", async () => {
    const now = new Date("2026-10-22T00:00:00.000Z")
    expect(await cardPage(store, "card_1", "wrong", now)).toMatchObject({
      name: "Steam",
      canManage: false,
      monthlyCapSats: 0n,
      scope: [],
    })
    expect(await cardPage(store, "card_1", "tok", now)).toMatchObject({
      canManage: true,
      spentSats: 12_000n,
      monthlyCapSats: 50_000n,
      resetsAt: "2026-11-01T00:00:00.000Z",
    })
    expect(await setCardState(store, "card_1", "wrong", "pause")).toMatchObject({ ok: false })
    expect(await setCardState(store, "card_1", "tok", "pause")).toEqual({
      ok: true,
      state: "paused",
    })
    expect((await cardPage(store, "card_1", "tok", now))?.state).toBe("paused")
    expect(await cardPage(store, "card_nope", "tok", now)).toBeNull()
  })
})
