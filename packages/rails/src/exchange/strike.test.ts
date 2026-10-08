import { RailError } from "@agentic-bitcoin/core"
import { describeExchangeRail } from "@agentic-bitcoin/core/contract"
import { STRIKE_QUOTE, clockAt } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { StrikeExchangeRail, centsToDecimal, decimalToCents, decimalToSats } from "./strike"

/** A scripted Strike: quotes expire per fixture, execute flips state, 422 when the balance is short. */
function fakeStrike(opts: { balanceCents?: bigint; now?: () => Date } = {}) {
  const calls: { method: string; path: string; body?: unknown; auth?: string }[] = []
  const quotes = new Map<string, Record<string, unknown>>()
  let balance = opts.balanceCents ?? 100_00n
  let seq = 0
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace("https://api.strike.me/v1", "")
    const headers = new Headers(init?.headers)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({
      method: init?.method ?? "GET",
      path,
      body,
      auth: headers.get("authorization") ?? undefined,
    })
    if (headers.get("authorization") !== "Bearer sk-test")
      return json({ data: { status: 401, code: "UNAUTHORIZED", message: "bad key" } }, 401)
    if (path === "/rates/ticker")
      return json([{ amount: "83169.00", sourceCurrency: "BTC", targetCurrency: "USD" }])
    if (path === "/balances")
      return json([
        { currency: "USD", current: centsToDecimal(balance), available: centsToDecimal(balance) },
      ])
    if (path === "/currency-exchange-quotes" && init?.method === "POST") {
      const cents = decimalToCents(body.amount.amount)
      if (cents > balance)
        return json(
          { data: { status: 422, code: "BALANCE_TOO_LOW", message: "Balance too low" } },
          422,
        )
      const id = `q-${++seq}`
      const q = {
        ...STRIKE_QUOTE,
        id,
        source: { amount: body.amount.amount, currency: "USD" },
        validUntil: new Date((opts.now?.() ?? new Date()).getTime() + 15_000).toISOString(),
      }
      quotes.set(id, q)
      return json(q)
    }
    const exec = /^\/currency-exchange-quotes\/(.+)\/execute$/.exec(path)
    if (exec && init?.method === "PATCH") {
      const q = quotes.get(exec[1] ?? "")
      if (!q) return json({ data: { status: 404, code: "NOT_FOUND" } }, 404)
      balance -= decimalToCents((q.source as { amount: string }).amount)
      quotes.set(exec[1] ?? "", { ...q, state: "COMPLETED", completed: "2026-10-07T12:00:05.000Z" })
      return new Response(null, { status: 202 })
    }
    const get = /^\/currency-exchange-quotes\/(.+)$/.exec(path)
    if (get) {
      const q = quotes.get(get[1] ?? "")
      return q ? json(q) : json({ data: { status: 404, code: "NOT_FOUND" } }, 404)
    }
    if (path === "/payment-quotes/lightning" && init?.method === "POST") {
      return json({
        paymentQuoteId: "pq-1",
        validUntil: "x",
        totalAmount: { amount: "0.00006100", currency: "BTC" },
      })
    }
    if (path === "/payment-quotes/pq-1/execute")
      return json({ paymentId: "pay-1", state: "COMPLETED" })
    return json({ data: { status: 404, code: "NOT_FOUND" } }, 404)
  }) as typeof fetch
  return {
    impl,
    calls,
    get balance() {
      return balance
    },
  }
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } })

describe("decimal boundary", () => {
  it("converts decimal strings to integer units, flooring", () => {
    expect(decimalToCents("5.00")).toBe(500n)
    expect(decimalToCents("0.1")).toBe(10n)
    expect(decimalToCents("12.349")).toBe(1234n)
    expect(decimalToSats("0.00006012")).toBe(6012n)
    expect(decimalToSats("1")).toBe(100_000_000n)
    expect(decimalToSats("0.000000019")).toBe(1n)
    expect(centsToDecimal(500n)).toBe("5.00")
    expect(centsToDecimal(7n)).toBe("0.07")
    expect(() => decimalToCents("abc")).toThrow(RailError)
    expect(() => decimalToCents("-1")).toThrow(RailError)
  })
})

describe("StrikeExchangeRail", () => {
  it("quotes with the right request shape and converts the response to integers", async () => {
    const s = fakeStrike()
    const rail = new StrikeExchangeRail({ apiKey: "sk-test", fetchImpl: s.impl, now: clockAt() })
    const q = await rail.createQuote({ usdCents: 5_00n })
    expect(s.calls[0]).toMatchObject({
      method: "POST",
      path: "/currency-exchange-quotes",
      body: { sell: "USD", buy: "BTC", amount: { amount: "5.00", currency: "USD" } },
      auth: "Bearer sk-test",
    })
    expect(q).toMatchObject({ usdCents: 500n, sats: 6012n })
    expect(q.usdCentsPerBtc).toBe((500n * 100_000_000n) / 6012n)
  })
  it("executes once (202 + read-back), is idempotent per quote id, and debits the balance", async () => {
    const s = fakeStrike()
    const rail = new StrikeExchangeRail({ apiKey: "sk-test", fetchImpl: s.impl, now: clockAt() })
    const q = await rail.createQuote({ usdCents: 5_00n })
    const e1 = await rail.executeQuote(q.id)
    expect(e1).toEqual({
      quoteId: q.id,
      sats: 6012n,
      usdCents: 500n,
      executedAt: "2026-10-07T12:00:05.000Z",
    })
    const e2 = await rail.executeQuote(q.id)
    expect(e2).toEqual(e1)
    expect(s.calls.filter((c) => c.path.endsWith("/execute"))).toHaveLength(1)
    expect(s.balance).toBe(95_00n)
  })
  it("refuses to execute a quote it knows is expired, without calling Strike", async () => {
    let t = Date.parse("2026-10-07T12:00:00.000Z")
    const s = fakeStrike({ now: () => new Date(t) })
    const rail = new StrikeExchangeRail({
      apiKey: "sk-test",
      fetchImpl: s.impl,
      now: () => new Date(t),
    })
    const q = await rail.createQuote({ usdCents: 5_00n })
    t += 20_000
    await expect(rail.executeQuote(q.id)).rejects.toMatchObject({ code: "EXPIRED" })
    expect(s.calls.some((c) => c.path.endsWith("/execute"))).toBe(false)
  })
  it("maps 422 BALANCE_TOO_LOW, 401, 404 and region blocks to typed errors", async () => {
    const s = fakeStrike({ balanceCents: 1_00n })
    const rail = new StrikeExchangeRail({ apiKey: "sk-test", fetchImpl: s.impl })
    await expect(rail.createQuote({ usdCents: 5_00n })).rejects.toMatchObject({
      code: "INSUFFICIENT_FUNDS",
    })
    await expect(rail.executeQuote("nope")).rejects.toMatchObject({ code: "NOT_FOUND" })
    const bad = new StrikeExchangeRail({ apiKey: "wrong", fetchImpl: s.impl })
    await expect(bad.getRate()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    const region = (async () => new Response("", { status: 451 })) as typeof fetch
    await expect(
      new StrikeExchangeRail({ apiKey: "k", fetchImpl: region }).getRate(),
    ).rejects.toThrow(/unavailable in your region/)
    const dead = (async () => {
      throw new Error("ECONNRESET")
    }) as typeof fetch
    await expect(
      new StrikeExchangeRail({ apiKey: "k", fetchImpl: dead }).getRate(),
    ).rejects.toMatchObject({ code: "UNREACHABLE" })
    expect(() => new StrikeExchangeRail({ apiKey: "" })).toThrow(RailError)
  })
  it("reads the ticker and the USD balance as integers", async () => {
    const s = fakeStrike({ balanceCents: 12_34n })
    const rail = new StrikeExchangeRail({ apiKey: "sk-test", fetchImpl: s.impl, now: clockAt() })
    expect(await rail.getRate()).toEqual({
      usdCentsPerBtc: 8_316_900n,
      asOf: "2026-10-07T12:00:00.000Z",
    })
    expect(await rail.getUsdBalance()).toBe(12_34n)
  })
  it("sweeps: pays a lightning invoice from the Strike balance", async () => {
    const s = fakeStrike()
    const rail = new StrikeExchangeRail({ apiKey: "sk-test", fetchImpl: s.impl })
    expect(await rail.payLightningInvoice("lnbc1fake")).toEqual({
      paymentId: "pay-1",
      totalSats: 6100n,
    })
    expect(s.calls.at(-2)).toMatchObject({
      path: "/payment-quotes/lightning",
      body: { lnInvoice: "lnbc1fake", sourceCurrency: "BTC" },
    })
  })
})

describeExchangeRail(
  "strike (scripted)",
  () => new StrikeExchangeRail({ apiKey: "sk-test", fetchImpl: fakeStrike().impl, now: clockAt() }),
)
