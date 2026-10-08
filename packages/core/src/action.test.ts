import { ACTIONS } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import {
  type Action,
  actionHash,
  describeAction,
  destinationOf,
  isSpend,
  parseAction,
  railOf,
  serializeAction,
  spendSats,
} from "./action"

const all = Object.values(ACTIONS) as Action[]

describe("action metadata", () => {
  it("maps every kind to a rail", () => {
    const rails = all.map(railOf)
    expect(new Set(rails)).toEqual(new Set(["wallet", "exchange", "goods", "compute", "onchain"]))
  })
  it("spend amounts: reads and receives are zero, spends are their amount", () => {
    expect(spendSats(ACTIONS.balance)).toBe(0n)
    expect(spendSats(ACTIONS.invoice)).toBe(0n)
    expect(spendSats(ACTIONS.cancel)).toBe(0n)
    expect(spendSats(ACTIONS.tip)).toBe(21n)
    expect(spendSats(ACTIONS.dca)).toBe(30_050n)
    expect(spendSats(ACTIONS.giftCard)).toBe(12_100n)
    expect(spendSats(ACTIONS.compute)).toBe(50n)
    expect(isSpend(ACTIONS.balance)).toBe(false)
    expect(isSpend(ACTIONS.tip)).toBe(true)
  })
  it("destinations are lower-cased identifiers or null", () => {
    expect(destinationOf(ACTIONS.tip)).toBe("gm@getalby.com")
    expect(destinationOf(ACTIONS.compute)).toBe("llm402.ai")
    expect(destinationOf(ACTIONS.giftCard)).toBe("bitrefill")
    expect(destinationOf(ACTIONS.dca)).toBe("strike")
    expect(destinationOf(ACTIONS.balance)).toBeNull()
    expect(destinationOf({ ...ACTIONS.payInvoice, destination: "Node@Example.COM" })).toBe(
      "node@example.com",
    )
  })
  it("describes every action in one human line without secrets", () => {
    for (const a of all) {
      const d = describeAction(a)
      expect(d.length).toBeGreaterThan(5)
      expect(d).not.toContain("lnbc")
      expect(d).not.toContain("idempotencyKey")
    }
  })
})

describe("serialisation and hashing", () => {
  it("round-trips every fixture with bigints intact", () => {
    for (const a of all) {
      expect(parseAction(serializeAction(a))).toEqual(a)
    }
  })
  it("canonical form is key-order independent", () => {
    const a: Action = { kind: "get_balance", idempotencyKey: "k", requestedBy: "user" }
    const b: Action = { requestedBy: "user", idempotencyKey: "k", kind: "get_balance" }
    expect(serializeAction(a)).toBe(serializeAction(b))
    expect(actionHash(a)).toBe(actionHash(b))
  })
  it("the hash changes when the amount changes by one sat", () => {
    const h1 = actionHash(ACTIONS.tip)
    const h2 = actionHash({ ...ACTIONS.tip, amountSats: 22n })
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toBe(h2)
  })
  it("rejects non-actions", () => {
    expect(() => parseAction('{"kind":"steal"}')).toThrow()
    expect(() => parseAction("42")).toThrow()
  })
})
