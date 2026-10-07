import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import {
  FakeWalletRail,
  InMemoryLedgerStore,
  type Policy,
  RailError,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { L402, POLICIES, PRICE, SPEC_INVOICE, clockAt } from "@agentic-bitcoin/fixtures"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { L402ComputeRail, authHeader, hostOf, parseChallenge } from "./l402"

describe("parseChallenge", () => {
  it("parses L402 and LSAT headers and decodes the amount", () => {
    const c = parseChallenge(L402.decodableHeader)
    expect(c).toEqual({
      macaroon: "AgEEbHNhdAJCAADFixture",
      invoice: SPEC_INVOICE.bolt11,
      amountSats: 250_000n,
    })
    expect(parseChallenge(L402.decodableHeader.replace(/^L402/, "LSAT")).amountSats).toBe(250_000n)
  })
  it("rejects junk, undecodable invoices, and non-URL hosts with typed errors", () => {
    expect(() => parseChallenge("Bearer nope")).toThrow(RailError)
    expect(() => parseChallenge(L402.header)).toThrow(/undecodable/) // the synthetic fixture invoice
    expect(() => hostOf("not a url")).toThrow(RailError)
    expect(hostOf("https://LLM402.ai:8443/v1")).toBe("llm402.ai:8443")
  })
})

/** A scripted fetch: 402 until the Authorization header carries macaroon:preimage, then 200. */
function scriptedFetch(
  opts: { macaroon?: string; invoice?: string; status402Body?: string; headerName?: string } = {},
) {
  const macaroon = opts.macaroon ?? "MAC"
  const calls: { url: string; auth?: string; method: string; body?: string }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const auth = headers.get("authorization") ?? undefined
    calls.push({
      url: String(input),
      auth,
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    })
    if (auth === `L402 ${macaroon}:${"d".repeat(64)}` || auth === `L402 ${macaroon}:cached`) {
      return new Response(JSON.stringify({ ok: true, echo: init?.body ?? null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    return new Response(opts.status402Body ?? "payment required", {
      status: 402,
      headers: {
        [opts.headerName ?? "WWW-Authenticate"]:
          `L402 macaroon="${macaroon}", invoice="${opts.invoice ?? SPEC_INVOICE.bolt11}"`,
      },
    })
  }) as typeof fetch
  return { impl, calls }
}

describe("L402ComputeRail", () => {
  it("returns the parsed challenge on 402 and the body otherwise", async () => {
    const { impl, calls } = scriptedFetch()
    const rail = new L402ComputeRail({ fetchImpl: impl })
    const r = await rail.request("https://api.example/x")
    expect(r.status).toBe(402)
    if ("challenge" in r) expect(r.challenge.amountSats).toBe(250_000n)
    const ok = await rail.requestWithToken(
      "https://api.example/x",
      { macaroon: "MAC", preimage: "d".repeat(64) },
      { method: "POST", body: '{"q":1}' },
    )
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.body)).toEqual({ ok: true, echo: '{"q":1}' })
    expect(calls[1]).toMatchObject({
      auth: `L402 MAC:${"d".repeat(64)}`,
      method: "POST",
      body: '{"q":1}',
    })
  })
  it("reuses a credential for the same host and drops it when the server stops accepting it", async () => {
    let t = 0
    const { impl, calls } = scriptedFetch()
    const rail = new L402ComputeRail({
      fetchImpl: impl,
      now: () => new Date(t),
      credentialTtlMs: 1000,
    })
    await rail.requestWithToken("https://api.example/a", {
      macaroon: "MAC",
      preimage: "d".repeat(64),
    })
    expect(rail.cachedCredential("api.example")).toEqual({
      macaroon: "MAC",
      preimage: "d".repeat(64),
    })
    const second = await rail.request("https://api.example/b")
    expect(second.status).toBe(200) // no new challenge, no payment
    expect(calls.at(-1)?.auth).toBe(`L402 MAC:${"d".repeat(64)}`)
    t = 2000 // TTL passed → fresh challenge
    const third = await rail.request("https://api.example/c")
    expect(third.status).toBe(402)
    expect(rail.cachedCredential("api.example")).toBeNull()
  })
  it("a cached credential that the server rejects yields the new challenge, not an error", async () => {
    const { impl } = scriptedFetch({ macaroon: "NEW" })
    const rail = new L402ComputeRail({ fetchImpl: impl })
    await rail.requestWithToken("https://api.example/a", { macaroon: "OLD", preimage: "cached" }) // 402 → not cached (not 2xx)
    expect(rail.cachedCredential("api.example")).toBeNull()
    const r = await rail.request("https://api.example/a")
    expect(r.status).toBe(402)
    if ("challenge" in r) expect(r.challenge.macaroon).toBe("NEW")
  })
  it("maps network failures and malformed 402s to typed errors", async () => {
    const dead = (async () => {
      throw new Error("ECONNREFUSED")
    }) as typeof fetch
    await expect(
      new L402ComputeRail({ fetchImpl: dead }).request("https://api.example/x"),
    ).rejects.toMatchObject({ code: "UNREACHABLE" })
    const noHeader = (async () => new Response("pay", { status: 402 })) as typeof fetch
    await expect(
      new L402ComputeRail({ fetchImpl: noHeader }).request("https://api.example/x"),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })
  it("truncates oversized bodies instead of buffering them", async () => {
    const big = (async () => new Response("x".repeat(5000), { status: 200 })) as typeof fetch
    const r = await new L402ComputeRail({ fetchImpl: big, maxBodyBytes: 1000 }).request(
      "https://api.example/x",
    )
    expect(r.status).toBe(200)
    if ("body" in r) expect(r.body).toMatch(/\[truncated at 1000 bytes\]$/)
  })
})

describe("full handshake through policy → wallet → L402 against a real local server", () => {
  let url = ""
  let hits = 0
  const macaroon = "AgEEbHNhdAJCAADLocal"
  const server = createServer((req, res) => {
    hits++
    const auth = req.headers.authorization ?? ""
    const m = /^L402 (\S+):([0-9a-f]{64})$/.exec(auth)
    if (m && m[1] === macaroon) {
      let body = ""
      req.on("data", (c) => {
        body += c
      })
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ answer: 42, got: body }))
      })
      return
    }
    res.writeHead(402, {
      "WWW-Authenticate": `L402 macaroon="${macaroon}", invoice="${SPEC_INVOICE.bolt11}"`,
    })
    res.end("payment required")
  })
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/answer`
  })
  afterAll(() => server.close())

  const policy: Policy = { ...POLICIES.open, confirmAboveSats: 1_000_000n }

  it("pays exactly the challenge amount within the ceiling, retries with the token, and ledgers it", async () => {
    const wallet = new FakeWalletRail({ balanceSats: 1_000_000n, now: clockAt() })
    const compute = new L402ComputeRail()
    const ledger = new InMemoryLedgerStore()
    const res = await execute({
      action: {
        kind: "pay_l402",
        idempotencyKey: "l402-1",
        requestedBy: "agent",
        url,
        host: hostOf(url),
        amountSats: 300_000n,
        method: "POST",
        body: '{"q":"meaning"}',
        headers: { "content-type": "application/json" },
      },
      policy,
      ledger,
      rails: { wallet, compute },
      now: clockAt(),
      context: { price: PRICE },
    })
    expect(res.status).toBe("succeeded")
    const out = (res as { result: { status: number; body: string } }).result
    expect(out.status).toBe(200)
    expect(JSON.parse(out.body)).toEqual({ answer: 42, got: '{"q":"meaning"}' })
    expect((await wallet.getBalance()).sats).toBe(1_000_000n - 250_000n - 251n)
    const [e] = await readEntries(ledger)
    expect(e?.detail).toBe("paid 250000 sats, HTTP 200")
    expect(hits).toBe(2)
    // second request: credential reused, no payment, one HTTP hit
    const before = (await wallet.getBalance()).sats
    const again = await execute({
      action: {
        kind: "pay_l402",
        idempotencyKey: "l402-2",
        requestedBy: "agent",
        url,
        host: hostOf(url),
        amountSats: 300_000n,
      },
      policy,
      ledger,
      rails: { wallet, compute },
      now: clockAt(),
    })
    expect(again.status).toBe("succeeded")
    expect((await wallet.getBalance()).sats).toBe(before)
    expect(hits).toBe(3)
  })
  it("refuses a challenge above the approved ceiling without paying", async () => {
    const wallet = new FakeWalletRail({ balanceSats: 1_000_000n })
    const res = await execute({
      action: {
        kind: "pay_l402",
        idempotencyKey: "l402-3",
        requestedBy: "agent",
        url,
        host: hostOf(url),
        amountSats: 100n,
      },
      policy,
      ledger: new InMemoryLedgerStore(),
      rails: { wallet, compute: new L402ComputeRail() },
    })
    expect(res).toMatchObject({ status: "failed", code: "AMOUNT_OUT_OF_RANGE" })
    expect((await wallet.getBalance()).sats).toBe(1_000_000n)
  })
  it("policy denies before any HTTP request when the host is deny-listed", async () => {
    const res = await execute({
      action: {
        kind: "pay_l402",
        idempotencyKey: "l402-4",
        requestedBy: "agent",
        url,
        host: hostOf(url),
        amountSats: 300_000n,
      },
      policy: { ...policy, denyDestinations: [hostOf(url)] },
      ledger: new InMemoryLedgerStore(),
      rails: { wallet: new FakeWalletRail(), compute: new L402ComputeRail() },
    })
    expect(res).toMatchObject({ status: "denied", decision: { reason: "DESTINATION_DENIED" } })
  })
  it("authHeader shape", () => {
    expect(authHeader({ macaroon: "m", preimage: "p" })).toBe("L402 m:p")
  })
})
