import type { Recipient } from "@agentic-bitcoin/core"
import { SPEC_INVOICE } from "@agentic-bitcoin/fixtures"
import { encryptSecret, parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import {
  dashboardFor,
  hashToken,
  invoiceFor,
  onboardRecipient,
  payRequestFor,
  tipSnippet,
} from "./service"
import { InMemoryReceiveStore } from "./store"

const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const BASE = "https://agentic-bitcoin.vercel.app"
const PK = "a".repeat(64)
const NWC = `nostr+walletconnect://${PK}?relay=wss://relay.example.com&secret=${"b".repeat(64)}`
const now = () => new Date("2026-10-10T12:00:00.000Z")

const upstream = {
  tag: "payRequest",
  callback: "https://getalby.com/lnurlp/gm/callback",
  minSendable: 1000,
  maxSendable: 500_000_000,
  metadata: "[]",
  commentAllowed: 100,
}
const fetchImpl = (async (url: string) => {
  const u = new URL(url)
  const key = `${u.host}${u.pathname}`
  if (key === "getalby.com/.well-known/lnurlp/gm")
    return { ok: true, status: 200, json: async () => upstream }
  if (key === "getalby.com/lnurlp/gm/callback")
    return { ok: true, status: 200, json: async () => ({ pr: SPEC_INVOICE.bolt11 }) }
  return { ok: false, status: 404, json: async () => ({}) }
}) as unknown as typeof fetch

const proxyRecipient: Recipient & { dashboardTokenHash?: string } = {
  slug: "gm",
  kind: "creator",
  name: "GM",
  lightningAddress: "gm@getalby.com",
  verified: { how: "operator", at: now().toISOString() },
  dashboardTokenHash: hashToken("tok"),
}
const fakeWallet = (methods: string[] = ["make_invoice", "lookup_invoice"]) => {
  const settled = new Set<string>()
  return {
    settled,
    walletFor: () => ({
      makeInvoice: async (i: { amountSats: bigint; memo: string }) => ({
        bolt11: `lnbc${i.amountSats}minted`,
        paymentHash: `${i.amountSats}`.padStart(64, "0"),
        amountSats: i.amountSats,
        expiresAt: "",
      }),
      lookupInvoice: async (h: string) =>
        settled.has(h)
          ? { state: "settled" as const, preimage: "p", settledAt: now().toISOString() }
          : { state: "pending" as const },
      describeConnection: async () => ({ methods }),
      close() {},
    }),
  }
}

describe("LNURL-pay for a proxy recipient", () => {
  it("serves a payRequest with our callback and mints via the recipient's own endpoint", async () => {
    const store = new InMemoryReceiveStore([proxyRecipient])
    const deps = { store, baseUrl: BASE, fetchImpl, now, secretsKey: KEY }
    const pr = await payRequestFor(deps, "gm")
    expect(pr).toMatchObject({
      tag: "payRequest",
      callback: `${BASE}/api/lnurlp/gm/callback`,
      maxSendable: 500_000_000,
    })
    const inv = await invoiceFor(deps, "gm", Number(SPEC_INVOICE.amountSats) * 1000, "hi")
    expect(inv).toMatchObject({ pr: SPEC_INVOICE.bolt11, paymentHash: SPEC_INVOICE.paymentHash })
    expect(store.invoices[0]).toMatchObject({ slug: "gm", source: "proxy", comment: "hi" })
    expect(await payRequestFor(deps, "nobody")).toEqual({
      status: "ERROR",
      reason: "unknown recipient",
    })
  })
  it("rate-limits invoice minting per recipient", async () => {
    const store = new InMemoryReceiveStore([proxyRecipient])
    for (let i = 0; i < 30; i++)
      await store.recordInvoice({
        paymentHash: `h${i}`,
        slug: "gm",
        amountMsats: 1000,
        source: "proxy",
        createdAt: now().toISOString(),
      })
    const r = await invoiceFor(
      { store, baseUrl: BASE, fetchImpl, now, secretsKey: KEY },
      "gm",
      250_000_000,
    )
    expect(r).toMatchObject({ status: "ERROR", reason: expect.stringContaining("too many") })
  })
})

describe("onboarding", () => {
  it("a Lightning address on the recipient's own domain is domain-verified at once", async () => {
    const store = new InMemoryReceiveStore()
    const f = (async (url: string) =>
      url.includes("grace-fellowship.example/.well-known/lnurlp/give")
        ? {
            ok: true,
            status: 200,
            json: async () => ({
              tag: "payRequest",
              minSendable: 1000,
              maxSendable: 1_000_000_000,
              callback: "https://grace-fellowship.example/cb",
            }),
          }
        : { ok: false, status: 404, json: async () => ({}) }) as unknown as typeof fetch
    const r = await onboardRecipient(
      { store, baseUrl: BASE, fetchImpl: f, now, secretsKey: KEY },
      {
        name: "Grace Fellowship Church",
        kind: "church",
        website: "grace-fellowship.example",
        lightningAddress: "Give@Grace-Fellowship.example",
        country: "us",
      },
    )
    expect(r).toMatchObject({
      ok: true,
      slug: "grace-fellowship-church",
      lightningAddress: "grace-fellowship-church@agentic-bitcoin.vercel.app",
      verified: true,
    })
    const saved = await store.getRecipient("grace-fellowship-church")
    expect(saved?.verified?.how).toBe("domain")
    expect(saved?.country).toBe("US")
    expect(saved?.dashboardTokenHash).toBe(
      hashToken((r as { dashboardToken: string }).dashboardToken),
    )
  })
  it("a wallet-provider address is pending until the operator verifies; dead addresses are refused", async () => {
    const store = new InMemoryReceiveStore()
    const deps = { store, baseUrl: BASE, fetchImpl, now, secretsKey: KEY }
    const r = await onboardRecipient(deps, {
      name: "GM Writes",
      kind: "creator",
      lightningAddress: "gm@getalby.com",
    })
    expect(r).toMatchObject({ ok: true, verified: false })
    expect((await store.getRecipient("gm-writes"))?.verified).toBeNull()
    expect(
      await onboardRecipient(deps, {
        name: "Dead",
        kind: "creator",
        lightningAddress: "x@dead.example",
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("does not answer") })
    expect(
      await onboardRecipient(deps, {
        name: "GM Writes",
        kind: "creator",
        lightningAddress: "gm@getalby.com",
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("taken") })
    expect(
      await onboardRecipient(deps, {
        name: "Bad Kind",
        kind: "bank",
        lightningAddress: "gm@getalby.com",
      }),
    ).toMatchObject({ ok: false })
  })
  it("a receive-only wallet connection is sealed; a spending one is refused", async () => {
    const store = new InMemoryReceiveStore()
    const ok = await onboardRecipient(
      { store, baseUrl: BASE, fetchImpl, now, secretsKey: KEY, walletFor: fakeWallet().walletFor },
      { name: "Ortiz Family", kind: "missionary", nwc: NWC },
    )
    expect(ok).toMatchObject({
      ok: true,
      slug: "ortiz-family",
      lightningAddress: "ortiz-family@agentic-bitcoin.vercel.app",
    })
    const saved = await store.getRecipient("ortiz-family")
    expect(saved?.nwcReceive).toBeDefined()
    expect(saved?.nwcReceive).not.toContain("secret=")
    expect(JSON.stringify(store.recipients.get("ortiz-family"))).not.toContain("b".repeat(64))
    const bad = await onboardRecipient(
      {
        store,
        baseUrl: BASE,
        fetchImpl,
        now,
        secretsKey: KEY,
        walletFor: fakeWallet(["make_invoice", "pay_invoice"]).walletFor,
      },
      { name: "Spender", kind: "creator", nwc: NWC },
    )
    expect(bad).toMatchObject({ ok: false, error: expect.stringContaining("can spend") })
    expect(
      await onboardRecipient(
        { store, baseUrl: BASE, fetchImpl, now, secretsKey: null },
        { name: "NoKey", kind: "creator", nwc: NWC },
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("SECRETS_KEY") })
  })
})

describe("nwc recipient: minting and dashboard", () => {
  it("mints in the recipient's wallet, then shows settlement from lookup_invoice", async () => {
    const fw = fakeWallet()
    const store = new InMemoryReceiveStore([
      {
        slug: "ortiz-family",
        kind: "missionary",
        name: "Ortiz Family",
        lightningAddress: "ortiz-family@agentic-bitcoin.vercel.app",
        verified: null,
        nwcReceive: encryptSecret(NWC, KEY),
        dashboardTokenHash: hashToken("tok"),
      },
    ])
    const deps = { store, baseUrl: BASE, fetchImpl, now, secretsKey: KEY, walletFor: fw.walletFor }
    const pr = await payRequestFor(deps, "ortiz-family")
    expect(pr).toMatchObject({ minSendable: 1000, commentAllowed: 200 })
    const inv = await invoiceFor(deps, "ortiz-family", 21_000, "lunch")
    expect(inv).toMatchObject({ pr: "lnbc21minted" })
    expect(await dashboardFor(deps, "ortiz-family", "wrong")).toBeNull()
    let dash = await dashboardFor(deps, "ortiz-family", "tok")
    expect(dash?.invoices).toHaveLength(1)
    expect(dash?.settledMsats).toBe(0)
    expect(dash?.canSeeSettlement).toBe(true)
    fw.settled.add((inv as { paymentHash: string }).paymentHash)
    dash = await dashboardFor(deps, "ortiz-family", "tok")
    expect(dash?.settledMsats).toBe(21_000)
    expect(dash?.invoices[0]?.preimage).toBe("p")
  })
  it("tip snippet points at our pages", () => {
    expect(tipSnippet(`${BASE}/`, "gm", "GM")).toBe(
      `<a href="${BASE}/tip/gm"><img src="${BASE}/api/tip-badge/gm" alt="Tip GM in bitcoin" height="32"></a>`,
    )
  })
})
