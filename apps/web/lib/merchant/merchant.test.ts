import { hashToken } from "@/lib/receive/service"
import { InMemoryReceiveStore, __setReceiveStore } from "@/lib/receive/store"
import { describe, expect, it } from "vitest"
import { fmtSats, fmtUsd, updateProfile } from "./service"

describe("portal formatting", () => {
  it("formats sats and dollars for display", () => {
    expect(fmtSats(12153)).toBe("12,153 sats")
    expect(fmtUsd(4999)).toBe("$49.99")
    expect(fmtUsd(161897000000)).toBe("$1,618,970,000.00")
  })
})

describe("profile editing", () => {
  it("saves name, https website, country and blurb with the right token; refuses otherwise", async () => {
    const store = new InMemoryReceiveStore([
      {
        slug: "cards",
        kind: "merchant",
        name: "Cards",
        lightningAddress: "pay@cards.example",
        verified: null,
        dashboardTokenHash: hashToken("tok"),
      },
    ])
    __setReceiveStore(store)
    try {
      expect(await updateProfile("cards", "wrong", { name: "X" })).toMatchObject({ ok: false })
      expect(await updateProfile("cards", "tok", { name: "C" })).toMatchObject({
        ok: false,
        error: /name/,
      })
      expect(
        await updateProfile("cards", "tok", {
          name: "Cardboard Castle",
          website: "cardboard.example",
          country: "us",
          description: " Singles. ",
        }),
      ).toEqual({
        ok: true,
        profile: {
          name: "Cardboard Castle",
          website: "https://cardboard.example",
          country: "US",
          description: "Singles.",
        },
      })
      expect((await store.getRecipient("cards"))?.website).toBe("https://cardboard.example")
      expect(
        await updateProfile("cards", "tok", {
          name: "Cardboard Castle",
          website: "http://plain.example",
        }),
      ).toMatchObject({ ok: false, error: /https/ })
      expect(
        await updateProfile("cards", "tok", { name: "Cardboard Castle", country: "USA" }),
      ).toMatchObject({ ok: false, error: /two letters/ })
    } finally {
      __setReceiveStore(null)
    }
  })
})
