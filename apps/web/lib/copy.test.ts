import { describe, expect, it } from "vitest"
import { COPY, TASKS, WHITEPAPER, homeCopyAsText } from "./copy"

/**
 * Quote-drift guard. These strings are verbatim from the 2008 whitepaper. If someone "improves"
 * one, this fails — change the fixture only with the PDF open.
 */
const VERBATIM: Record<keyof typeof WHITEPAPER, string> = {
  p2p: "sent directly from one party to another without going through a financial institution",
  proof: "cryptographic proof instead of trust",
  parties: "any two willing parties",
  casual: "small casual transactions",
  simplicity: "The network is robust in its unstructured simplicity.",
}

describe("whitepaper phrases", () => {
  it("are verbatim", () => {
    expect(WHITEPAPER).toEqual(VERBATIM)
  })
  it("the headline and interface beats quote them verbatim", () => {
    const text = homeCopyAsText()
    expect(text).toContain(VERBATIM.p2p)
    expect(text).toContain(VERBATIM.proof)
    expect(text).toContain(VERBATIM.parties)
  })
})

describe("landing copy", () => {
  it("has exactly five example tasks, mirroring instinct.com", () => {
    expect(TASKS).toHaveLength(5)
    expect(new Set(TASKS.map((t) => t.icon)).size).toBe(5)
  })
  it("never gives advice", () => {
    const text = homeCopyAsText().toLowerCase()
    for (const banned of ["should buy", "best time", "guaranteed", "returns", "invest"]) {
      expect(text).not.toContain(banned)
    }
    expect(COPY.footer.note).toContain("Not financial advice")
    expect(COPY.footer.note).toContain("Non-custodial")
  })
})
