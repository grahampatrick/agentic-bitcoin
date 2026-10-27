import { describe, expect, it } from "vitest"
import { fmtSats, fmtUsd } from "./service"

describe("portal formatting", () => {
  it("formats sats and dollars for display", () => {
    expect(fmtSats(12153)).toBe("12,153 sats")
    expect(fmtUsd(4999)).toBe("$49.99")
    expect(fmtUsd(161897000000)).toBe("$1,618,970,000.00")
  })
})
