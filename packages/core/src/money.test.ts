import { PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { MoneyError, cents, centsToSats, formatCents, formatSats, sats, satsToCents } from "./money"

describe("money constructors", () => {
  it("accept integers and bigints", () => {
    expect(sats(21)).toBe(21n)
    expect(sats(21n)).toBe(21n)
    expect(cents(2500)).toBe(2500n)
  })
  it.each([1.5, -1, Number.NaN, 2 ** 53])("reject %s", (v) => {
    expect(() => sats(v)).toThrow(MoneyError)
  })
  it("reject negative bigints", () => {
    expect(() => cents(-1n)).toThrow(MoneyError)
  })
})

describe("conversions at a snapshot", () => {
  it("sats → cents rounds down", () => {
    expect(satsToCents(1_202n, PRICE)).toBe(99n) // 1,202 sats ≈ $0.9997 → 99 cents
    expect(satsToCents(100_000_000n, PRICE)).toBe(8_316_900n)
    expect(satsToCents(0n, PRICE)).toBe(0n)
  })
  it("cents → sats rounds down", () => {
    expect(centsToSats(100n, PRICE)).toBe(1_202n)
    expect(centsToSats(25_00n, PRICE)).toBe(30_059n)
  })
  it("rejects a non-positive price", () => {
    expect(() => centsToSats(100n, { ...PRICE, usdCentsPerBtc: 0n })).toThrow(MoneyError)
  })
})

describe("formatting", () => {
  it("formats cents and sats for humans", () => {
    expect(formatCents(8_316_900n)).toBe("$83,169.00")
    expect(formatCents(5n)).toBe("$0.05")
    expect(formatSats(21_000n)).toBe("21,000 sats")
  })
})
