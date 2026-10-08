import {
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  RailError,
  actionHash,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { describeGoodsRail } from "@agentic-bitcoin/core/contract"
import { POLICIES, PRICE, SPEC_INVOICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { BitrefillGoodsRail, _internal, redemptionText } from "./bitrefill"

/**
 * A scripted Bitrefill: search returns two products; invoices start unpaid and progress on each
 * GET /invoices/{id} once `paid()` is called; the order endpoint reveals redemption when delivered.
 */
function fakeBitrefill() {
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = []
  const invoices = new Map<
    string,
    { status: string; payment: Record<string, unknown>; orders: Record<string, unknown>[] }
  >()
  let seq = 0
  let paidInvoice: string | null = null
  let pollsSincePaid = 0
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname.replace("/v2", "")
    const headers = new Headers(init?.headers)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({
      method: init?.method ?? "GET",
      path: path + url.search,
      body,
      auth: headers.get("authorization") ?? undefined,
    })
    if (headers.get("authorization") !== "Bearer br-test")
      return json({ message: "unauthorized" }, 401)
    if (path === "/products/search") {
      return json({
        data: [
          {
            id: "amazon-us",
            name: "Amazon.com",
            country_code: "US",
            currency: "USD",
            in_stock: true,
            range: { min: 5, max: 500, step: 1, price_rate: 1 },
          },
          {
            id: "mint-10",
            name: "Mint Mobile $10",
            country_code: "US",
            currency: "USD",
            in_stock: true,
            packages: { id: "mint-10<&>10", value: "10", price: 10 },
          },
          { id: "gone", name: "Out of stock", in_stock: false },
        ],
      })
    }
    if (path === "/invoices" && init?.method === "POST") {
      if (body.products[0].product_id === "nope")
        return json({ message: "no such product", error_code: "product_not_found" }, 400)
      const id = `inv-${++seq}`
      const inv = {
        status: "not_delivered",
        payment: {
          method: "lightning",
          address: SPEC_INVOICE.bolt11,
          currency: "BTC",
          price: 0.0025,
          status: "unpaid",
        },
        orders: [
          {
            id: `ord-${seq}`,
            status: "created",
            product: {
              id: body.products[0].product_id,
              name: "Amazon.com",
              value: String(body.products[0].value),
              currency: "USD",
            },
          },
        ],
      }
      invoices.set(id, inv)
      return json({ data: { id, ...inv } })
    }
    const gi = /^\/invoices\/(.+)$/.exec(path)
    if (gi) {
      const inv = invoices.get(gi[1] ?? "")
      if (!inv) return json({ message: "not found" }, 404)
      if (paidInvoice === gi[1]) {
        pollsSincePaid++
        inv.payment.status = "paid"
        inv.status = pollsSincePaid >= 2 ? "complete" : "not_delivered"
        if (pollsSincePaid >= 2)
          inv.orders[0] = {
            ...inv.orders[0],
            status: "delivered",
            delivered_time: "2026-10-07T12:00:30.000Z",
          }
      }
      return json({ data: { id: gi[1], ...inv } })
    }
    const go = /^\/orders\/(.+)$/.exec(path)
    if (go) {
      const inv = [...invoices.values()].find((i) => (i.orders[0] as { id: string }).id === go[1])
      if (!inv) return json({ message: "not found" }, 404)
      const o = inv.orders[0] as Record<string, unknown>
      const delivered = o.status === "delivered"
      return json({
        data: {
          ...o,
          redemption_info: delivered
            ? {
                code: "AMZN-1234-5678",
                pin: "",
                link: "https://amazon.com/redeem",
                instructions: "Enter the code at checkout",
              }
            : undefined,
        },
      })
    }
    return json({ message: "not found" }, 404)
  }) as typeof fetch
  return {
    impl,
    calls,
    paid: (invoiceId: string) => {
      paidInvoice = invoiceId
      pollsSincePaid = 0
    },
    invoices,
  }
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } })

describe("BitrefillGoodsRail", () => {
  it("searches with the right query, drops out-of-stock, labels ranged vs fixed products", async () => {
    const b = fakeBitrefill()
    const rail = new BitrefillGoodsRail({ apiKey: "br-test", fetchImpl: b.impl })
    const found = await rail.searchProducts("amazon")
    expect(b.calls[0]).toMatchObject({
      method: "GET",
      path: "/products/search?q=amazon&limit=20",
      auth: "Bearer br-test",
    })
    expect(found).toEqual([
      { id: "amazon-us", name: "Amazon.com (US) 5–500 USD", usdCents: null },
      { id: "mint-10", name: "Mint Mobile $10 (US)", usdCents: 1000n },
    ])
    expect(await rail.searchProducts("   ")).toEqual([])
  })
  it("creates a lightning invoice, takes the amount from the DECODED bolt11, and reports unpaid", async () => {
    const b = fakeBitrefill()
    const rail = new BitrefillGoodsRail({ apiKey: "br-test", fetchImpl: b.impl })
    const o = await rail.createOrder({ productId: "amazon-us", usdCents: 25_00n })
    expect(b.calls[0]).toMatchObject({
      method: "POST",
      path: "/invoices",
      body: {
        products: [{ product_id: "amazon-us", quantity: 1, value: 25 }],
        payment_method: "lightning",
      },
    })
    expect(o).toEqual({
      orderId: "ord-1",
      bolt11: SPEC_INVOICE.bolt11,
      amountSats: 250_000n,
      state: "unpaid",
    })
    expect(await rail.getOrder("ord-1")).toMatchObject({ state: "unpaid", redemption: undefined })
  })
  it("payment is not delivery: paid → still polling → delivered with redemption, once", async () => {
    const b = fakeBitrefill()
    const rail = new BitrefillGoodsRail({ apiKey: "br-test", fetchImpl: b.impl })
    const o = await rail.createOrder({ productId: "amazon-us", usdCents: 25_00n })
    b.paid("inv-1")
    const p1 = await rail.getOrder(o.orderId)
    expect(p1).toMatchObject({ state: "paid", redemption: undefined })
    const p2 = await rail.getOrder(o.orderId)
    expect(p2).toMatchObject({
      state: "delivered",
      redemption:
        "code: AMZN-1234-5678; link: https://amazon.com/redeem; instructions: Enter the code at checkout",
    })
  })
  it("maps errors: unknown product, 401, 404, network", async () => {
    const b = fakeBitrefill()
    const rail = new BitrefillGoodsRail({ apiKey: "br-test", fetchImpl: b.impl })
    await expect(rail.createOrder({ productId: "nope", usdCents: 1_00n })).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
    await expect(rail.getOrder("missing")).rejects.toMatchObject({ code: "NOT_FOUND" })
    await expect(rail.createOrder({ productId: "amazon-us", usdCents: 0n })).rejects.toMatchObject({
      code: "AMOUNT_OUT_OF_RANGE",
    })
    await expect(
      new BitrefillGoodsRail({ apiKey: "wrong", fetchImpl: b.impl }).searchProducts("x"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    const dead = (async () => {
      throw new Error("ECONNRESET")
    }) as typeof fetch
    await expect(
      new BitrefillGoodsRail({ apiKey: "k", fetchImpl: dead }).searchProducts("x"),
    ).rejects.toMatchObject({ code: "UNREACHABLE" })
    expect(() => new BitrefillGoodsRail({ apiKey: "" })).toThrow(RailError)
  })
  it("refuses an invoice whose bolt11 is missing or undecodable", async () => {
    const noLn = (async () =>
      json({
        data: {
          id: "i",
          payment: { method: "lightning", address: "bc1qxyz" },
          orders: [{ id: "o" }],
        },
      })) as typeof fetch
    await expect(
      new BitrefillGoodsRail({ apiKey: "k", fetchImpl: noLn }).createOrder({
        productId: "p",
        usdCents: 1_00n,
      }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" })
    const junkLn = (async () =>
      json({
        data: {
          id: "i",
          payment: { method: "lightning", address: "lnbc1junk" },
          orders: [{ id: "o" }],
        },
      })) as typeof fetch
    await expect(
      new BitrefillGoodsRail({ apiKey: "k", fetchImpl: junkLn }).createOrder({
        productId: "p",
        usdCents: 1_00n,
      }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })
  it("state mapping and redemption text helpers", () => {
    const { stateOf } = _internal
    expect(stateOf({ id: "i", status: "complete" })).toBe("delivered")
    expect(stateOf({ id: "i", status: "expired" })).toBe("failed")
    expect(stateOf({ id: "i", status: "not_delivered", payment: { status: "paid" } })).toBe("paid")
    expect(stateOf({ id: "i", status: "not_delivered", payment: { status: "unpaid" } })).toBe(
      "unpaid",
    )
    expect(stateOf({ id: "i" }, { id: "o", status: "created", delivered_time: "x" })).toBe("unpaid") // created + stray timestamp ≠ delivered
    expect(redemptionText("Go to example.com and enter ABC")).toBe(
      "Go to example.com and enter ABC",
    )
    expect(redemptionText({ code: "X", pin: "" })).toBe("code: X")
    expect(redemptionText({ weird: 1 })).toBe('{"weird":1}')
    expect(redemptionText(undefined)).toBeUndefined()
  })
})

describeGoodsRail(
  "bitrefill (scripted)",
  () => new BitrefillGoodsRail({ apiKey: "br-test", fetchImpl: fakeBitrefill().impl }),
  {
    query: "amazon",
    productId: "amazon-us",
    usdCents: 25_00n,
  },
)

describe("end to end through the executor: confirm → pay → poll → sealed", () => {
  it("delivers the code once to the caller and only the sealed form to the ledger", async () => {
    const b = fakeBitrefill()
    const goods = new BitrefillGoodsRail({ apiKey: "br-test", fetchImpl: b.impl })
    const wallet = new FakeWalletRail({ balanceSats: 1_000_000n })
    const ledger = new InMemoryLedgerStore()
    const policy: Policy = POLICIES.open
    const action = {
      kind: "buy_product" as const,
      merchant: "bitrefill" as const,
      productId: "amazon-us",
      description: "Amazon $25",
      usdCents: 25_00n,
      amountSats: 260_000n,
      idempotencyKey: "g1",
      requestedBy: "user" as const,
    }
    const base = {
      policy,
      ledger,
      rails: { wallet, goods },
      context: { price: PRICE },
      seal: (s: string) => `enc:${Buffer.from(s).toString("base64")}`,
    }
    const first = await execute({ action, ...base })
    expect(first.status).toBe("awaiting_confirmation")
    // the wallet "pays" instantly; tell the scripted merchant the invoice is paid when it is polled
    const origGet = goods.getOrder.bind(goods)
    let told = false
    goods.getOrder = async (id) => {
      if (!told) {
        b.paid("inv-1")
        told = true
      }
      return origGet(id)
    }
    const res = await execute({
      action,
      ...base,
      confirmation: { actionHash: actionHash(action), confirmedBy: "gm", at: "t" },
      delivery: { pollMs: 0, maxPolls: 5, sleep: async () => {} },
    })
    expect(res.status).toBe("succeeded")
    const order = (res as { result: { order: { state: string; redemption?: string } } }).result
      .order
    expect(order).toMatchObject({
      state: "delivered",
      redemption: expect.stringContaining("AMZN-1234-5678"),
    })
    expect((await wallet.getBalance()).sats).toBe(1_000_000n - 250_000n - 251n)
    const entry = (await readEntries(ledger)).find((e) => e.outcome === "succeeded")
    expect(entry?.sealed).toMatch(/^enc:/)
    expect(
      JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    ).not.toContain("AMZN-1234")
  })
})
