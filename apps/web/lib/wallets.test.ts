import { describe, expect, it } from "vitest"
import { WALLETS, hostWalletFromUserAgent, isMobileUserAgent, walletById } from "./wallets"

describe("wallet links", () => {
  it("every wallet builds a URL from a BOLT11, upper-cased for QR-friendly encoding; only the generic link is verified", () => {
    const pr = "lnbc10u1pabc"
    for (const w of WALLETS) expect(w.url(pr)).toContain("LNBC10U1PABC")
    expect(walletById("generic")?.url(pr)).toBe("lightning:LNBC10U1PABC")
    expect(walletById("zeus")?.url(pr)).toBe("zeusln:lightning:LNBC10U1PABC")
    expect(WALLETS.filter((w) => w.verified).map((w) => w.id)).toEqual(["generic"])
  })
  it("detects mobile and known host wallets from the user agent", () => {
    expect(isMobileUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true)
    expect(isMobileUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(false)
    expect(hostWalletFromUserAgent("Mozilla/5.0 (iPhone) Strike/3.2")).toBe("strike")
    expect(hostWalletFromUserAgent("Mozilla/5.0 (Android) Chrome")).toBeNull()
  })
})
