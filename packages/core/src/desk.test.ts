import { describe, expect, it } from "vitest"
import type { Action } from "./action"
import { actionHash } from "./action"
import {
  DESK_SETTINGS,
  type Desk,
  SETTING_OPS,
  type SettingChange,
  describeSetting,
  parseSettingSats,
  settingNarrows,
} from "./desk"
import { execute } from "./executor"
import { InMemoryLedgerStore } from "./ledger"
import { DEFAULT_POLICY, type Policy, evaluate } from "./policy"

const change = (
  setting: SettingChange["setting"],
  op: string,
  value = "",
  name = "",
): SettingChange => ({ setting, op, value, name })

const asAction = (c: SettingChange): Action => ({
  kind: "change_setting",
  idempotencyKey: "k1",
  requestedBy: "agent",
  ...c,
})

describe("parseSettingSats", () => {
  it("reads whole sats however a person writes them, and nothing else", () => {
    expect(parseSettingSats("50000")).toBe(50_000n)
    expect(parseSettingSats("50,000 sats")).toBe(50_000n)
    expect(parseSettingSats(" 1_000 sat ")).toBe(1_000n)
    expect(parseSettingSats("0")).toBe(0n)
    expect(parseSettingSats("12.5")).toBeNull()
    expect(parseSettingSats("-5")).toBeNull()
    expect(parseSettingSats("lots")).toBeNull()
  })
})

describe("settingNarrows", () => {
  const p = DEFAULT_POLICY // daily 100k · per action 50k · confirm at 10k
  it("lets a stop or a narrower fence through without a yes", () => {
    for (const c of [
      change("kill_switch", "on"),
      change("rail", "off", "goods"),
      change("replace", "off"),
      change("deny_destination", "add", "*@evil.example"),
      change("daily_cap", "set", "20000"),
      change("per_action_cap", "set", "50,000"),
      change("confirm_above", "set", "0"),
      change("cold_storage", "remove", "bc1qexample"),
      change("recipient", "remove", "my-church"),
      change("campaign_updates", "follow", "well-for-kibera"),
      change("campaign_updates", "unfollow", "well-for-kibera"),
      change("workspace_links", "revoke"),
    ])
      expect(settingNarrows(c, p), `${c.setting} ${c.op}`).toBe(true)
  })
  it("holds everything that widens, redirects, or touches a credential for a yes", () => {
    for (const c of [
      change("kill_switch", "off"),
      change("rail", "on", "exchange"),
      change("replace", "on", "50"),
      change("replace", "cap", "20"),
      change("deny_destination", "remove", "*@evil.example"),
      change("allow_destination", "add", "alice@example.com"),
      change("allow_destination", "remove", "alice@example.com"),
      change("daily_cap", "set", "100001"),
      change("daily_cap", "set", "0"),
      change("daily_cap", "set", "a lot"),
      change("per_action_cap", "set", "60000"),
      change("confirm_above", "set", "20000"),
      change("cold_storage", "add", "bc1qexample"),
      change("recipient", "add", "give@church.example", "My Church"),
      change("lightning_address", "claim", "graham"),
      change("lightning_address", "forward", "me@other.example"),
      change("lightning_address", "remove"),
      change("wallet", "disconnect"),
      change("key", "remove", "strike"),
      change("referral_code", "join", "abc234"),
    ])
      expect(settingNarrows(c, p), `${c.setting} ${c.op}`).toBe(false)
  })
  it("has an op list and a summary for every setting", () => {
    for (const s of DESK_SETTINGS) {
      expect(SETTING_OPS[s].length).toBeGreaterThan(0)
      for (const op of SETTING_OPS[s])
        expect(describeSetting(change(s, op, "5000", "Name")).length).toBeGreaterThan(8)
    }
  })
})

describe("describeSetting", () => {
  it("shows what a cap replaces when the policy is known", () => {
    expect(describeSetting(change("daily_cap", "set", "200000"), DEFAULT_POLICY)).toBe(
      "Set your daily cap to 200,000 sats (now 100,000 sats)",
    )
    expect(describeSetting(change("confirm_above", "set", "0"))).toBe(
      "Ask you before every payment",
    )
    expect(describeSetting(change("kill_switch", "off"))).toBe("Lift the kill switch")
  })
})

describe("policy: show and change_setting", () => {
  const killed: Policy = {
    ...DEFAULT_POLICY,
    killSwitch: true,
    rails: { ...DEFAULT_POLICY.rails, wallet: false },
  }
  const window = { spentSats: 0n }
  it("a view is allowed even with the kill switch on and the wallet rail off", () => {
    const d = evaluate(
      { kind: "show", idempotencyKey: "k", requestedBy: "agent", view: "activity" },
      killed,
      window,
    )
    expect(d.type).toBe("allow")
  })
  it("lifting the kill switch is possible while it is on, and always waits for a yes", () => {
    const a = asAction(change("kill_switch", "off"))
    const d = evaluate(a, killed, window)
    expect(d).toEqual({
      type: "needs_confirmation",
      summary: "Lift the kill switch",
      actionHash: actionHash(a),
    })
  })
  it("a narrower cap is allowed at once; a wider one waits", () => {
    expect(
      evaluate(asAction(change("daily_cap", "set", "1000")), DEFAULT_POLICY, window).type,
    ).toBe("allow")
    expect(
      evaluate(asAction(change("daily_cap", "set", "1000000")), DEFAULT_POLICY, window).type,
    ).toBe("needs_confirmation")
  })
})

describe("executor: the desk hook", () => {
  const calls: string[] = []
  const desk: Desk = {
    async show(view, arg) {
      calls.push(`show ${view} ${arg}`.trim())
      return view === "workspace_link"
        ? { text: "A link was sent.", direct: "https://example.test/me?t=secret" }
        : { text: `the ${view} view` }
    },
    async check() {
      return null
    },
    async change(c) {
      calls.push(`change ${c.setting} ${c.op} ${c.value}`.trim())
      if (c.value === "boom") throw new Error("that address does not answer")
      return { text: "Changed." }
    },
  }
  const base = { policy: DEFAULT_POLICY, rails: {}, desk }

  it("show returns the text and stores none of it", async () => {
    const ledger = new InMemoryLedgerStore()
    const r = await execute({
      ...base,
      ledger,
      action: { kind: "show", idempotencyKey: "k", requestedBy: "agent", view: "orders", arg: "" },
    })
    expect(r.status).toBe("succeeded")
    expect((r as { result: { text: string } }).result.text).toBe("the orders view")
    expect(JSON.stringify(await ledger.events())).not.toContain("the orders view")
  })

  it("a widening change runs only with a confirmation bound to its hash", async () => {
    const ledger = new InMemoryLedgerStore()
    const action = asAction(change("rail", "on", "exchange"))
    const before = calls.length
    const first = await execute({ ...base, ledger, action })
    expect(first.status).toBe("awaiting_confirmation")
    expect(calls.length).toBe(before)
    const wrong = await execute({
      ...base,
      ledger,
      action,
      confirmation: { actionHash: "0".repeat(64), confirmedBy: "u", at: "2026-11-11T00:00:00Z" },
    })
    expect(wrong.status).toBe("awaiting_confirmation")
    const ok = await execute({
      ...base,
      ledger,
      action,
      confirmation: {
        actionHash: actionHash(action),
        confirmedBy: "u",
        at: "2026-11-11T00:00:00Z",
      },
    })
    expect(ok.status).toBe("succeeded")
    expect(calls.at(-1)).toBe("change rail on exchange")
  })

  it("a narrowing change applies at once, and a failure is reported, not swallowed", async () => {
    const ledger = new InMemoryLedgerStore()
    const ok = await execute({ ...base, ledger, action: asAction(change("kill_switch", "on")) })
    expect(ok.status).toBe("succeeded")
    const bad = await execute({
      ...base,
      ledger,
      action: asAction(change("cold_storage", "remove", "boom")),
    })
    expect(bad).toMatchObject({ status: "failed", error: "that address does not answer" })
  })

  it("without a desk the action fails instead of pretending", async () => {
    const r = await execute({
      policy: DEFAULT_POLICY,
      rails: {},
      ledger: new InMemoryLedgerStore(),
      action: { kind: "show", idempotencyKey: "k", requestedBy: "agent", view: "limits" },
    })
    expect(r.status).toBe("failed")
  })
})
