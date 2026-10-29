import { describe, expect, it } from "vitest"
import { applyMeOp, workspaceFor } from "./service"

const now = new Date("2026-10-29T12:00:00Z")
const env = {
  REFERRAL_REWARD_SATS: "1000",
  REFERRAL_FRIEND_SATS: "500",
  NEXT_PUBLIC_CONTACT_EMAIL: "hello@anvard.ai",
} as unknown as NodeJS.ProcessEnv

describe("the workspace (M23, ADR-0027)", () => {
  it("opens the keyless demo with the demo token and nothing else", async () => {
    expect(await workspaceFor(undefined, now, env)).toBeNull()
    expect(await workspaceFor("nope", now, env)).toBeNull()
    const w = await workspaceFor("demo", now, env)
    expect(w).not.toBeNull()
    if (!w) return
    expect(w.identity).toEqual({ surface: "Demo", masked: "a fictional account" })
    expect(w.wallet.connected).toBe(true)
    expect(w.keys).toEqual({ strike: true, bitrefill: false })
    expect(w.address?.name).toBe("demo")
    expect(w.cards.map((c) => c.name)).toEqual(["Steam purchases"])
    expect(w.invites.on).toBe(true)
    expect(w.invites.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(w.invites.link).toContain(`/join/${w.invites.code}`)
    expect(w.invites.joined).toBe(2)
    expect(w.invites.qualified).toBe(1)
    expect(w.invites.usedThisMonth).toBe(1)
    expect(w.invites.friends.map((f) => [f.masked, f.qualified])).toEqual([
      ["+1 ••• ••• 0102", false],
      ["+1 ••• ••• 0101", true],
    ])
    expect(w.rewards).toEqual({ pendingSats: "0", payableSats: "1000", paidSats: "1200" })
    expect(w.links).toBe(1)
    expect(w.contact.email).toBe("hello@anvard.ai")
    expect(w.policy.denyDestinations).toEqual(["*.sweepstakes.example"])
  })

  it("changes limits, rails, lists and cards the way chat would, and refuses the rest", async () => {
    expect(await applyMeOp("nope", { op: "kill", on: true }, now)).toEqual({
      ok: false,
      error: "This link is not valid any more",
    })
    const r1 = await applyMeOp("demo", { op: "limits", dailyCapSats: "250000" }, now)
    expect(r1.ok && r1.policy?.dailyCapSats).toBe(250_000n)
    const bad = await applyMeOp("demo", { op: "limits", perActionCapSats: "999999999" }, now)
    expect(bad).toEqual({ ok: false, error: "The per-action cap cannot exceed the daily cap" })
    const r2 = await applyMeOp("demo", { op: "rail", rail: "goods", on: false }, now)
    expect(r2.ok && r2.policy?.rails.goods).toBe(false)
    expect((await applyMeOp("demo", { op: "rail", rail: "teleport", on: true }, now)).ok).toBe(
      false,
    )
    const r3 = await applyMeOp("demo", { op: "allow_add", destination: "Shop@Example.com" }, now)
    expect(r3.ok && r3.policy?.allowDestinations).toEqual(["shop@example.com"])
    const r4 = await applyMeOp("demo", { op: "allow_remove", destination: "shop@example.com" }, now)
    expect(r4.ok && r4.policy?.allowDestinations).toEqual([])
    const r5 = await applyMeOp("demo", { op: "card", id: "card_demo", state: "pause" }, now)
    expect(r5).toEqual({ ok: true, card: { id: "card_demo", state: "paused" } })
    expect((await workspaceFor("demo", now, env))?.cards[0]?.state).toBe("paused")
    await applyMeOp("demo", { op: "card", id: "card_demo", state: "resume" }, now)
    expect(await applyMeOp("demo", { op: "card", id: "card_zzz", state: "pause" }, now)).toEqual({
      ok: false,
      error: "No such card",
    })
    expect((await applyMeOp("demo", { op: "dance" }, now)).ok).toBe(false)
    const k = await applyMeOp("demo", { op: "kill", on: true }, now)
    expect(k.ok && k.policy?.killSwitch).toBe(true)
    await applyMeOp("demo", { op: "kill", on: false }, now)
  })

  it("log out revokes this link; log out everywhere revokes them all", async () => {
    // the demo token is the only link; revoking it closes the demo for this process
    const w = await workspaceFor("demo", now, env)
    expect(w?.links).toBe(1)
    expect(await applyMeOp("demo", { op: "logout_all" }, now)).toEqual({ ok: true })
    expect(await workspaceFor("demo", now, env)).toBeNull()
    expect(await applyMeOp("demo", { op: "logout" }, now)).toEqual({
      ok: false,
      error: "This link is not valid any more",
    })
  })
})
