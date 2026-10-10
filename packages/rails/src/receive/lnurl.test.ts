import { RailError } from "@agentic-bitcoin/core"
import { SPEC_INVOICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import {
  assessReceiveConnection,
  buildInvoice,
  buildPayRequest,
  lnurlMetadata,
  upstreamPayRequest,
} from "./lnurl"

const fakeFetch =
  (routes: Record<string, unknown | ((url: URL) => unknown)>) => async (url: string) => {
    const u = new URL(url)
    const key = `${u.host}${u.pathname}`
    const hit = routes[key]
    if (hit === undefined) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => (typeof hit === "function" ? hit(u) : hit) }
  }

const upstream = {
  tag: "payRequest",
  callback: "https://getalby.com/lnurlp/gm/callback",
  minSendable: 1000,
  maxSendable: 500_000_000,
  metadata: JSON.stringify([["text/plain", "Sats for gm"]]),
  commentAllowed: 50,
}

describe("payRequest", () => {
  it("proxies an existing address: our callback, their limits, our metadata", async () => {
    const pr = await buildPayRequest({
      slug: "gm",
      name: "GM",
      baseUrl: "https://agentic-bitcoin.vercel.app",
      source: { kind: "proxy", lightningAddress: "gm@getalby.com" },
      fetchImpl: fakeFetch({ "getalby.com/.well-known/lnurlp/gm": upstream }),
    })
    expect(pr).toEqual({
      tag: "payRequest",
      callback: "https://agentic-bitcoin.vercel.app/api/lnurlp/gm/callback",
      minSendable: 1000,
      maxSendable: 500_000_000,
      metadata: lnurlMetadata("GM", "gm@agentic-bitcoin.vercel.app"),
      commentAllowed: 50,
    })
  })
  it("a receive-only wallet gets our defaults", async () => {
    const pr = await buildPayRequest({
      slug: "grace",
      name: "Grace",
      baseUrl: "https://x.example/",
      source: {
        kind: "nwc",
        wallet: {
          makeInvoice: async () => ({ bolt11: "", paymentHash: "", amountSats: 0n, expiresAt: "" }),
        },
      },
      fetchImpl: fakeFetch({}),
    })
    expect(pr.callback).toBe("https://x.example/api/lnurlp/grace/callback")
    expect(pr.minSendable).toBe(1000)
    expect(pr.commentAllowed).toBe(200)
  })
  it("rejects dead or non-LNURL upstreams", async () => {
    await expect(upstreamPayRequest("a@dead.example", fakeFetch({}))).rejects.toMatchObject({
      code: "UNREACHABLE",
    })
    await expect(
      upstreamPayRequest(
        "a@b.example",
        fakeFetch({ "b.example/.well-known/lnurlp/a": { tag: "withdraw" } }),
      ),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" })
    await expect(
      upstreamPayRequest(
        "a@b.example",
        fakeFetch({ "b.example/.well-known/lnurlp/a": { status: "ERROR", reason: "gone" } }),
      ),
    ).rejects.toMatchObject({ code: "REJECTED", message: "gone" })
  })
})

describe("invoice", () => {
  const specAmount = Number(SPEC_INVOICE.amountSats) * 1000
  it("proxy: relays amount and comment to the recipient's callback and verifies the invoice amount", async () => {
    let seen: URL | undefined
    const inv = await buildInvoice({
      name: "GM",
      source: { kind: "proxy", lightningAddress: "gm@getalby.com" },
      amountMsats: specAmount,
      comment: "thank you\u0000!",
      fetchImpl: fakeFetch({
        "getalby.com/.well-known/lnurlp/gm": upstream,
        "getalby.com/lnurlp/gm/callback": (u: URL) => {
          seen = u
          return { pr: SPEC_INVOICE.bolt11, routes: [] }
        },
      }),
    })
    expect(seen?.searchParams.get("amount")).toBe(String(specAmount))
    expect(seen?.searchParams.get("comment")).toBe("thank you!")
    expect(inv).toEqual({
      pr: SPEC_INVOICE.bolt11,
      paymentHash: SPEC_INVOICE.paymentHash,
      amountMsats: specAmount,
      source: "proxy",
    })
  })
  it("proxy: refuses an invoice whose amount differs from what was asked", async () => {
    await expect(
      buildInvoice({
        name: "GM",
        source: { kind: "proxy", lightningAddress: "gm@getalby.com" },
        amountMsats: 21_000,
        fetchImpl: fakeFetch({
          "getalby.com/.well-known/lnurlp/gm": upstream,
          "getalby.com/lnurlp/gm/callback": { pr: SPEC_INVOICE.bolt11 },
        }),
      }),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" })
  })
  it("nwc: mints in the recipient's wallet with the comment in the memo, whole sats only", async () => {
    const calls: unknown[] = []
    const wallet = {
      makeInvoice: async (i: { amountSats: bigint; memo: string }) => {
        calls.push(i)
        return {
          bolt11: "lnbc1minted",
          paymentHash: "h".repeat(64),
          amountSats: i.amountSats,
          expiresAt: "",
        }
      },
    }
    const inv = await buildInvoice({
      name: "Grace",
      source: { kind: "nwc", wallet },
      amountMsats: 2_000_000,
      comment: "tithe",
      fetchImpl: fakeFetch({}),
    })
    expect(calls[0]).toMatchObject({ amountSats: 2000n, memo: "Give to Grace: tithe" })
    expect(inv.source).toBe("nwc")
    await expect(
      buildInvoice({
        name: "Grace",
        source: { kind: "nwc", wallet },
        amountMsats: 1500,
        fetchImpl: fakeFetch({}),
      }),
    ).rejects.toBeInstanceOf(RailError)
  })
  it("range checks happen before any network call", async () => {
    await expect(
      buildInvoice({
        name: "x",
        source: { kind: "proxy", lightningAddress: "a@b.example" },
        amountMsats: 0,
        fetchImpl: fakeFetch({}),
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" })
  })
})

describe("assessReceiveConnection", () => {
  it("accepts make_invoice (+lookup) and refuses anything that can spend", () => {
    expect(
      assessReceiveConnection({ methods: ["make_invoice", "lookup_invoice", "get_info"] }),
    ).toEqual({ ok: true, warning: undefined })
    expect(assessReceiveConnection({ methods: ["make_invoice"] }).ok).toBe(true)
    expect(assessReceiveConnection({ methods: ["make_invoice", "pay_invoice"] })).toMatchObject({
      ok: false,
    })
    expect(assessReceiveConnection({ methods: ["get_balance"] })).toMatchObject({ ok: false })
    expect(assessReceiveConnection({})).toMatchObject({ ok: false })
  })
})
