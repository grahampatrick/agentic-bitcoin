import { describe, expect, it } from "vitest"
import {
  SANDBOX_COLD_ADDRESS,
  initialSandbox,
  packState,
  sandboxTurn,
  unpackState,
} from "./sandbox"
import { ScriptedLlmClient } from "./scripted"

const now = () => new Date("2026-10-08T12:00:00.000Z")

describe("sandbox end to end (scripted model, real policy/executor/ledger)", () => {
  it("balance → small tip → big payment parked → yes → ledger, with state round-tripping through JSON", async () => {
    const llm = new ScriptedLlmClient()
    let state = initialSandbox()
    const t1 = await sandboxTurn(llm, state, "what's my balance?", now)
    expect(t1.reply).toBe("Your wallet holds 250,000 sats.")
    state = unpackState(packState(t1.state))
    const t2 = await sandboxTurn(llm, state, "pay 500 sats to gm@getalby.com", now)
    expect(t2.reply).toMatch(/^Paid\. Pay gm@getalby\.com · 500 sats/)
    expect(t2.state.walletSats).toBe("249499")
    state = unpackState(packState(t2.state))
    const t3 = await sandboxTurn(llm, state, "send 20000 sats to friend@walletofsatoshi.com", now)
    expect(t3.pending?.summary).toContain("20,000 sats (≈ $16.63")
    expect(t3.reply).toContain("Reply yes")
    expect(t3.state.walletSats).toBe("249499")
    state = unpackState(packState(t3.state))
    const t4 = await sandboxTurn(llm, state, "yes", now)
    expect(t4.reply).toMatch(/^Paid\./)
    expect(t4.state.walletSats).toBe("229478")
    expect(t4.ledger.map((e) => e.outcome)).toEqual([
      "succeeded",
      "succeeded",
      "awaiting_confirmation",
      "succeeded",
    ])
  })
  it("caps are enforced from the ledger window; denials are explained", async () => {
    const llm = new ScriptedLlmClient()
    const t = await sandboxTurn(llm, initialSandbox(), "pay 60000 sats to gm@getalby.com", now)
    expect(t.reply).toContain("per action cap")
    expect(t.ledger[0]?.outcome).toBe("denied")
  })
  it("gift card: always confirm, then delivered with the code handed over separately", async () => {
    const llm = new ScriptedLlmClient()
    const t1 = await sandboxTurn(llm, initialSandbox(), "get me a $10 amazon gift card", now)
    expect(t1.pending?.summary).toContain('Buy "Amazon.com gift card $10" from bitrefill')
    const t2 = await sandboxTurn(llm, t1.state, "yes", now)
    expect(t2.reply).toContain("Delivered")
    expect(t2.deliveries[0]).toContain("FAKE-CODE-")
    expect(JSON.stringify(t2.state.history)).not.toContain("FAKE-CODE-")
  })
  it("sweep to the registered cold address asks, then moves the excess", async () => {
    const llm = new ScriptedLlmClient()
    const t1 = await sandboxTurn(
      llm,
      initialSandbox(),
      `sweep everything above 200000 sats to cold storage ${SANDBOX_COLD_ADDRESS} max 50000`,
      now,
    )
    expect(t1.pending?.summary).toContain("Sweep to cold storage")
    const t2 = await sandboxTurn(llm, t1.state, "yes", now)
    expect(t2.reply).toContain("Swept 50,000 sats")
    expect(t2.state.onchainSats).toBe((1_200_000n - 50_000n - 500n).toString())
    const t3 = await sandboxTurn(
      llm,
      initialSandbox(),
      "sweep to cold storage bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
      now,
    )
    expect(t3.reply).toContain("destination not allowed")
  })
  it("paid API call charges 21 sats and returns the body", async () => {
    const llm = new ScriptedLlmClient()
    const t = await sandboxTurn(
      llm,
      initialSandbox(),
      "fetch https://api.example/answer up to 50 sats",
      now,
    )
    expect(t.reply).toContain("Fetched (HTTP 200)")
    expect(t.state.walletSats).toBe((250_000n - 21n - 1n).toString())
  })
  it("advice questions get the no-advice line, no tool, no ledger row", async () => {
    const t = await sandboxTurn(
      new ScriptedLlmClient(),
      initialSandbox(),
      "should I buy more bitcoin today?",
      now,
    )
    expect(t.reply).toContain("don't give financial advice")
    expect(t.ledger).toHaveLength(0)
  })
  it("chit-chat gets help, no tool, no ledger row", async () => {
    const t = await sandboxTurn(new ScriptedLlmClient(), initialSandbox(), "hello", now)
    expect(t.reply).toContain("Try:")
    expect(t.ledger).toHaveLength(0)
  })
})
