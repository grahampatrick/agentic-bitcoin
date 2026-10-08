import { RailError } from "@agentic-bitcoin/core"
import { COLD_ADDRESS } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { LndOnChainRail } from "./lnd"

function fakeLnd(opts: { confirmed?: bigint; mac?: string } = {}) {
  let confirmed = opts.confirmed ?? 1_000_000n
  let unconfirmed = 0n
  const calls: { method: string; path: string; body?: unknown; mac?: string }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace("https://lnd.test:8080", "")
    const headers = new Headers(init?.headers)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({
      method: init?.method ?? "GET",
      path,
      body,
      mac: headers.get("grpc-metadata-macaroon") ?? undefined,
    })
    if (headers.get("grpc-metadata-macaroon") !== (opts.mac ?? "deadbeef"))
      return json({ code: 2, message: "permission denied" }, 500)
    if (path === "/v1/balance/blockchain")
      return json({
        confirmed_balance: confirmed.toString(),
        unconfirmed_balance: unconfirmed.toString(),
      })
    if (path === "/v1/transactions") {
      const amt = BigInt(body.amount)
      if (body.addr === "bad") return json({ code: 2, message: "invalid address" }, 500)
      if (amt + 400n > confirmed)
        return json(
          { code: 2, message: "insufficient funds available to construct transaction" },
          500,
        )
      confirmed -= amt + 400n
      unconfirmed = 0n
      return json({ txid: "ab".repeat(32) })
    }
    return json({ message: "not found" }, 404)
  }) as typeof fetch
  return { impl, calls }
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

describe("LndOnChainRail", () => {
  it("reads balances as integers with the macaroon header", async () => {
    const l = fakeLnd()
    const rail = new LndOnChainRail({
      baseUrl: "https://lnd.test:8080/",
      macaroonHex: "deadbeef",
      fetchImpl: l.impl,
    })
    expect(await rail.getBalance()).toEqual({ confirmedSats: 1_000_000n, unconfirmedSats: 0n })
    expect(l.calls[0]).toMatchObject({ path: "/v1/balance/blockchain", mac: "deadbeef" })
  })
  it("sends with the right body, derives the fee from the balance delta, and is idempotent", async () => {
    const l = fakeLnd()
    const rail = new LndOnChainRail({
      baseUrl: "https://lnd.test:8080",
      macaroonHex: "deadbeef",
      fetchImpl: l.impl,
      defaultSatPerVbyte: 3,
    })
    const r = await rail.send({ address: COLD_ADDRESS, amountSats: 500_000n, idempotencyKey: "s1" })
    expect(r).toEqual({ txid: "ab".repeat(32), feeSats: 400n })
    expect(l.calls.find((c) => c.path === "/v1/transactions")?.body).toMatchObject({
      addr: COLD_ADDRESS,
      amount: "500000",
      sat_per_vbyte: 3,
    })
    const again = await rail.send({
      address: COLD_ADDRESS,
      amountSats: 500_000n,
      idempotencyKey: "s1",
    })
    expect(again).toEqual(r)
    expect(l.calls.filter((c) => c.path === "/v1/transactions")).toHaveLength(1)
  })
  it("maps LND errors to typed codes", async () => {
    const l = fakeLnd({ confirmed: 1_000n })
    const rail = new LndOnChainRail({
      baseUrl: "https://lnd.test:8080",
      macaroonHex: "deadbeef",
      fetchImpl: l.impl,
    })
    await expect(
      rail.send({ address: COLD_ADDRESS, amountSats: 5_000n, idempotencyKey: "a" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" })
    await expect(
      rail.send({ address: "bad", amountSats: 100n, idempotencyKey: "b" }),
    ).rejects.toMatchObject({ code: "REJECTED" })
    const wrong = new LndOnChainRail({
      baseUrl: "https://lnd.test:8080",
      macaroonHex: "cafe",
      fetchImpl: l.impl,
    })
    await expect(wrong.getBalance()).rejects.toMatchObject({ code: "UNAUTHORIZED" })
    expect(() => new LndOnChainRail({ baseUrl: "", macaroonHex: "zz" })).toThrow(RailError)
    const dead = (async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch
    await expect(
      new LndOnChainRail({ baseUrl: "https://x", macaroonHex: "aa", fetchImpl: dead }).getBalance(),
    ).rejects.toMatchObject({ code: "UNREACHABLE" })
  })
})
