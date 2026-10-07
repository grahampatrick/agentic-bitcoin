/**
 * Contract suites. Any adapter — fake or real — must pass these. Real adapters run them opt-in
 * (env-gated) from their own package; the fakes run them in core's CI.
 *
 * Usage:
 *   describeWalletRail("nwc", () => new NwcWalletRail(cfg), { fundedSats: 10_000n })
 */
import { describe, expect, it } from "vitest"
import { type ExchangeRail, type GoodsRail, RailError, type WalletRail } from "../src/rails"

export interface WalletHarness {
  /** A bolt11 the wallet can pay, and its amount. Fakes accept anything starting with lnbc. */
  payable: { bolt11: string; amountSats: bigint }
  /** A bolt11 that must fail with REJECTED. */
  failing?: { bolt11: string; amountSats: bigint }
  /** A valid lightning address for `resolveAddress`. */
  address: string
}

export function describeWalletRail(
  name: string,
  make: () => WalletRail | Promise<WalletRail>,
  h: WalletHarness,
): void {
  describe(`WalletRail contract: ${name}`, () => {
    it("reports a non-negative bigint balance", async () => {
      const w = await make()
      const { sats } = await w.getBalance()
      expect(typeof sats).toBe("bigint")
      expect(sats >= 0n).toBe(true)
    })
    it("creates an invoice that is pending until settled", async () => {
      const w = await make()
      const inv = await w.makeInvoice({ amountSats: 1_000n, memo: "contract", expirySeconds: 600 })
      expect(inv.bolt11.startsWith("ln")).toBe(true)
      expect(inv.amountSats).toBe(1_000n)
      expect(inv.paymentHash).toMatch(/^[0-9a-f]{64}$/)
      expect(Date.parse(inv.expiresAt)).toBeGreaterThan(0)
      const look = await w.lookupInvoice(inv.paymentHash)
      expect(look.state).toBe("pending")
    })
    it("rejects a zero-amount invoice with AMOUNT_OUT_OF_RANGE", async () => {
      const w = await make()
      await expect(
        w.makeInvoice({ amountSats: 0n, memo: "x", expirySeconds: 60 }),
      ).rejects.toMatchObject({
        name: "RailError",
        code: "AMOUNT_OUT_OF_RANGE",
      })
    })
    it("NOT_FOUND for an unknown payment hash", async () => {
      const w = await make()
      await expect(w.lookupInvoice("f".repeat(64))).rejects.toBeInstanceOf(RailError)
    })
    it("pays an invoice and returns a preimage, and is idempotent on the key", async () => {
      const w = await make()
      const before = (await w.getBalance()).sats
      const p1 = await w.payInvoice({ ...h.payable, idempotencyKey: `contract-${Date.now()}-a` })
      expect(p1.preimage).toMatch(/^[0-9a-f]{64}$/)
      expect(p1.amountSats).toBe(h.payable.amountSats)
      expect(p1.feeSats >= 0n).toBe(true)
      const after = (await w.getBalance()).sats
      expect(before - after >= h.payable.amountSats).toBe(true)
      // same key → same payment, no second debit
      const key = `contract-${Date.now()}-b`
      const a = await w.payInvoice({ ...h.payable, idempotencyKey: key })
      const mid = (await w.getBalance()).sats
      const b = await w.payInvoice({ ...h.payable, idempotencyKey: key })
      expect(b).toEqual(a)
      expect((await w.getBalance()).sats).toBe(mid)
    })
    if (h.failing) {
      const failing = h.failing
      it("surfaces a failed payment as a typed RailError", async () => {
        const w = await make()
        await expect(
          w.payInvoice({ ...failing, idempotencyKey: `contract-fail-${Date.now()}` }),
        ).rejects.toBeInstanceOf(RailError)
      })
    }
    it("resolves a lightning address to a bolt11 and rejects junk", async () => {
      const w = await make()
      const { bolt11 } = await w.resolveAddress(h.address, 21n)
      expect(bolt11.startsWith("ln")).toBe(true)
      await expect(w.resolveAddress("not an address", 21n)).rejects.toBeInstanceOf(RailError)
    })
  })
}

export function describeExchangeRail(
  name: string,
  make: () => ExchangeRail | Promise<ExchangeRail>,
): void {
  describe(`ExchangeRail contract: ${name}`, () => {
    it("quotes a positive integer price", async () => {
      const x = await make()
      const r = await x.getRate()
      expect(typeof r.usdCentsPerBtc).toBe("bigint")
      expect(r.usdCentsPerBtc > 0n).toBe(true)
    })
    it("creates a quote with integer sats and an expiry, then executes it once", async () => {
      const x = await make()
      const q = await x.createQuote({ usdCents: 5_00n })
      expect(q.usdCents).toBe(5_00n)
      expect(q.sats > 0n).toBe(true)
      expect(Date.parse(q.expiresAt)).toBeGreaterThan(0)
      const e1 = await x.executeQuote(q.id)
      expect(e1.sats).toBe(q.sats)
      const e2 = await x.executeQuote(q.id)
      expect(e2).toEqual(e1)
    })
    it("rejects a zero quote and an unknown quote id", async () => {
      const x = await make()
      await expect(x.createQuote({ usdCents: 0n })).rejects.toBeInstanceOf(RailError)
      await expect(x.executeQuote("nope")).rejects.toMatchObject({ code: "NOT_FOUND" })
    })
  })
}

export function describeGoodsRail(
  name: string,
  make: () => GoodsRail | Promise<GoodsRail>,
  h: { query: string; productId: string; usdCents: bigint },
): void {
  describe(`GoodsRail contract: ${name}`, () => {
    it("finds products", async () => {
      const g = await make()
      const found = await g.searchProducts(h.query)
      expect(found.length).toBeGreaterThan(0)
      expect(found[0]?.id).toBeTruthy()
    })
    it("creates an unpaid order carrying a bolt11, readable back by id", async () => {
      const g = await make()
      const o = await g.createOrder({ productId: h.productId, usdCents: h.usdCents })
      expect(o.state).toBe("unpaid")
      expect(o.bolt11.startsWith("ln")).toBe(true)
      expect(o.amountSats > 0n).toBe(true)
      expect(o.redemption).toBeUndefined()
      expect((await g.getOrder(o.orderId)).orderId).toBe(o.orderId)
    })
    it("NOT_FOUND for unknown products and orders", async () => {
      const g = await make()
      await expect(g.createOrder({ productId: "nope", usdCents: 1_00n })).rejects.toMatchObject({
        code: "NOT_FOUND",
      })
      await expect(g.getOrder("nope")).rejects.toMatchObject({ code: "NOT_FOUND" })
    })
  })
}
