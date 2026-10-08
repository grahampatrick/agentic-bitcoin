import { DEFAULT_POLICY } from "@agentic-bitcoin/core"
import { describe, expect, it } from "vitest"
import {
  assessPairing,
  looksLikeSecret,
  parseKeyCommand,
  startWizard,
  wizardStep,
} from "./onboarding"

describe("assessPairing", () => {
  const good = {
    alias: "hub",
    network: "mainnet",
    methods: ["get_balance", "make_invoice", "pay_invoice", "lookup_invoice"],
    budget: { usedSats: 0n, totalSats: 20_000n, renewal: "daily" },
  }
  it("accepts a budgeted connection with the needed methods", () => {
    expect(assessPairing(good, { allowUnbudgeted: false })).toEqual({
      ok: true,
      description: "Paired hub on mainnet. Wallet budget 20,000 sats daily (0 sats used).",
    })
  })
  it("refuses an unbudgeted connection unless overridden", () => {
    const r = assessPairing({ ...good, budget: null }, { allowUnbudgeted: false })
    expect(r).toMatchObject({ ok: false, unbudgeted: true })
    expect(assessPairing({ ...good, budget: null }, { allowUnbudgeted: true })).toMatchObject({
      ok: true,
      description: expect.stringContaining("NONE"),
    })
  })
  it("refuses a connection missing a required method", () => {
    expect(
      assessPairing({ ...good, methods: ["get_balance"] }, { allowUnbudgeted: false }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("make_invoice") })
  })
  it("tolerates a wallet that does not report methods", () => {
    expect(assessPairing({ ...good, methods: undefined }, { allowUnbudgeted: false }).ok).toBe(true)
  })
})

describe("looksLikeSecret", () => {
  it("catches connection strings and key-shaped tokens, not normal chat", () => {
    expect(looksLikeSecret("nostr+walletconnect://abc?relay=wss://r&secret=def")).toBe(true)
    expect(looksLikeSecret(`here secret=${"a".repeat(64)}`)).toBe(true)
    expect(looksLikeSecret("my key is sk-abcdefghijklmnopqrstuvwxyz0123")).toBe(true)
    expect(looksLikeSecret("pay 500 sats to gm@getalby.com")).toBe(false)
    expect(looksLikeSecret("what's my balance?")).toBe(false)
  })
})

describe("wizard", () => {
  it("walks daily → confirm → rails and yields a policy", () => {
    const { state } = startWizard()
    const s1 = wizardStep(state, "20,000")
    expect(s1.state?.step).toBe("confirm")
    expect(s1.state?.draft.dailyCapSats).toBe(20_000n)
    expect(s1.state?.draft.perActionCapSats).toBe(20_000n) // per-action capped to daily
    const s2 = wizardStep(s1.state as NonNullable<typeof s1.state>, "5000 sats")
    expect(s2.state?.step).toBe("rails")
    const s3 = wizardStep(s2.state as NonNullable<typeof s2.state>, "wallet, goods")
    expect(s3.state).toBeNull()
    expect(s3.policy).toMatchObject({
      dailyCapSats: 20_000n,
      confirmAboveSats: 5_000n,
      rails: { wallet: true, goods: true, exchange: false, compute: false },
    })
  })
  it("re-asks on bad input and accepts 'all' / 'wallet only'", () => {
    const { state } = startWizard()
    expect(wizardStep(state, "lots").state?.step).toBe("daily")
    const rails = { step: "rails" as const, draft: DEFAULT_POLICY }
    expect(wizardStep(rails, "all").policy?.rails).toEqual({
      wallet: true,
      exchange: true,
      goods: true,
      compute: true,
    })
    expect(wizardStep(rails, "wallet only").policy?.rails).toEqual({
      wallet: true,
      exchange: false,
      goods: false,
      compute: false,
    })
    expect(wizardStep(rails, "teleport").state?.step).toBe("rails")
  })
})

describe("parseKeyCommand", () => {
  it("parses show/set/remove and rejects junk", () => {
    expect(parseKeyCommand([])).toEqual({ kind: "show" })
    expect(parseKeyCommand(["strike", "abcdefghijklmnopqrstuvwxyz"])).toEqual({
      kind: "set",
      name: "strike",
      value: "abcdefghijklmnopqrstuvwxyz",
    })
    expect(parseKeyCommand(["Bitrefill", "remove"])).toEqual({ kind: "remove", name: "bitrefill" })
    expect(parseKeyCommand(["coinbase", "x"]).kind).toBe("error")
    expect(parseKeyCommand(["strike", "short"]).kind).toBe("error")
  })
})
