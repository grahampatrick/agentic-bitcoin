import { describe, expect, it } from "vitest"
import { DEFAULT_POLICY } from "./policy"
import {
  InMemoryWebLinkStore,
  describeIdentity,
  hashWebToken,
  newWebToken,
  patchPolicy,
  webLinkExpiry,
  workspaceUrl,
} from "./workspace"

const now = new Date("2026-10-29T12:00:00Z")

describe("web links (M23, ADR-0027)", () => {
  it("mints base64url tokens, stores only the hash, and forgets them at expiry or on revoke", async () => {
    const token = newWebToken(new Uint8Array(24).fill(7))
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(() => newWebToken(new Uint8Array(8))).toThrow()
    const store = new InMemoryWebLinkStore()
    const link = {
      tokenHash: hashWebToken(token),
      userId: "signal:+15550001111",
      createdAt: now.toISOString(),
      expiresAt: webLinkExpiry(now),
    }
    await store.create(link)
    expect(link.expiresAt).toBe("2026-11-28T12:00:00.000Z")
    expect(await store.userFor(hashWebToken(token), now)).toBe("signal:+15550001111")
    expect(await store.userFor(hashWebToken("nope"), now)).toBeNull()
    expect(await store.userFor(hashWebToken(token), new Date("2026-11-28T12:00:01Z"))).toBeNull()
    expect((await store.listForUser("signal:+15550001111")).length).toBe(1)
    await store.revokeAll("signal:+15550001111")
    expect(await store.userFor(hashWebToken(token), now)).toBeNull()
    expect(workspaceUrl("https://anvard.ai/", "a b")).toBe("https://anvard.ai/me?t=a%20b")
  })

  it("describes an identity without revealing the handle", () => {
    expect(describeIdentity("signal:+13039952649")).toEqual({
      surface: "Signal",
      masked: "+1 ••• ••• 2649",
    })
    expect(describeIdentity("signal:+447700900123")).toEqual({
      surface: "Signal",
      masked: "+44 ••• ••• 0123",
    })
    expect(describeIdentity("discord:123456789012")).toEqual({
      surface: "Discord",
      masked: "…9012",
    })
  })
})

describe("patchPolicy", () => {
  it("applies caps, rails, the kill switch and destination lists with the same rules as chat", () => {
    const r1 = patchPolicy(DEFAULT_POLICY, {
      dailyCapSats: "200,000",
      perActionCapSats: "60000",
      confirmAboveSats: 0n,
      rails: { exchange: true },
      allowAdd: "Shop@Example.com",
      denyAdd: "*.evil.example",
    })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.policy.dailyCapSats).toBe(200_000n)
    expect(r1.policy.perActionCapSats).toBe(60_000n)
    expect(r1.policy.confirmAboveSats).toBe(0n)
    expect(r1.policy.rails.exchange).toBe(true)
    expect(r1.policy.allowDestinations).toEqual(["shop@example.com"])
    expect(r1.policy.denyDestinations).toEqual(["*.evil.example"])
    const r2 = patchPolicy(r1.policy, { allowRemove: "shop@example.com", killSwitch: true })
    expect(r2.ok && r2.policy.allowDestinations).toEqual([])
    expect(r2.ok && r2.policy.killSwitch).toBe(true)
    expect(DEFAULT_POLICY.rails.exchange).toBe(false) // never mutated
  })

  it("refuses bad numbers, inverted caps, unknown rails and junk destinations", () => {
    expect(patchPolicy(DEFAULT_POLICY, { dailyCapSats: "12.5" })).toEqual({
      ok: false,
      error: "Daily cap must be a whole number of sats",
    })
    expect(patchPolicy(DEFAULT_POLICY, { perActionCapSats: "500000" })).toEqual({
      ok: false,
      error: "The per-action cap cannot exceed the daily cap",
    })
    expect(patchPolicy(DEFAULT_POLICY, { dailyCapSats: "0" }).ok).toBe(false)
    expect(patchPolicy(DEFAULT_POLICY, { rails: { teleport: true } as never }).ok).toBe(false)
    expect(patchPolicy(DEFAULT_POLICY, { allowAdd: "a" }).ok).toBe(false)
  })
})
