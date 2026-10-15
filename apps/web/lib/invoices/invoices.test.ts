import { createHash } from "node:crypto"
import { InMemoryInvoiceStore, type IssuedInvoice } from "@agentic-bitcoin/core"
import { PRICE } from "@agentic-bitcoin/fixtures"
import { encryptSecret, parseKey } from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { hashToken } from "../receive/service"
import { InMemoryReceiveStore } from "../receive/store"
import {
  claimInvoicePaid,
  createRecipientInvoice,
  payView,
  recipientInvoiceAction,
  recipientInvoices,
  recipientInvoicesCsv,
} from "./service"

const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const NWC = `nostr+walletconnect://${"a".repeat(64)}?relay=wss://relay.example.com&secret=${"b".repeat(64)}`
const now = () => new Date("2026-10-14T12:00:00.000Z")

function world() {
  const settled = new Set<string>()
  const receive = new InMemoryReceiveStore([
    {
      slug: "grace",
      kind: "church",
      name: "Grace Church",
      lightningAddress: "grace@x.example",
      verified: { how: "operator", at: "t" },
      nwcReceive: encryptSecret(NWC, KEY),
      dashboardTokenHash: hashToken("tok"),
    },
  ])
  const invoices = new InMemoryInvoiceStore()
  const deps = {
    invoices,
    receive,
    price: async () => PRICE,
    baseUrl: "https://x.example",
    secretsKey: KEY,
    now,
    walletFor: () => ({
      makeInvoice: async (i: { amountSats: bigint }) => ({
        bolt11: `lnbc${i.amountSats}minted`,
        paymentHash: `${i.amountSats}`.padStart(64, "0"),
        amountSats: i.amountSats,
        expiresAt: "",
      }),
      lookupInvoice: async (h: string) =>
        settled.has(h)
          ? { state: "settled" as const, preimage: "cd".repeat(32) }
          : { state: "pending" as const },
      close() {},
    }),
  }
  return { deps, invoices, settled }
}

describe("recipient invoices", () => {
  it("creates from the dashboard, mints lazily on the pay page, sees settlement, exports CSV", async () => {
    const w = world()
    expect(
      await createRecipientInvoice(w.deps, "grace", "nope", {
        kind: "invoice",
        payerName: "Bob",
        items: [{ description: "Deck", qty: 1, price: "200" }],
      }),
    ).toMatchObject({ ok: false })
    const c = await createRecipientInvoice(w.deps, "grace", "tok", {
      kind: "invoice",
      payerName: "Bob",
      payerContact: "bob@x.example",
      items: [{ description: "Deck", qty: 2, price: "99.50" }],
      dueDate: "2026-10-20",
    })
    expect(c).toMatchObject({
      ok: true,
      number: "INV-0001",
      link: expect.stringMatching(/^https:\/\/x\.example\/pay\/[a-z0-9]{28}$/),
    })
    const token = (c as { link: string }).link.split("/pay/")[1] as string
    const stored = (await w.invoices.getByToken(token)) as IssuedInvoice
    expect(stored.bolt11).toBeUndefined()
    expect(
      JSON.stringify(stored, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    ).not.toContain("bob@x.example")
    let v = await payView(w.deps, token)
    expect(v).toMatchObject({
      number: "INV-0001",
      issuerName: "Grace Church",
      totalCents: 19_900,
      bolt11: "lnbc239271minted",
      status: "open",
      canVerify: true,
    })
    w.settled.add("239271".padStart(64, "0"))
    v = await payView(w.deps, token)
    expect(v?.status).toBe("paid")
    const list = await recipientInvoices(w.deps, "grace", "tok")
    expect(list?.[0]).toMatchObject({
      number: "INV-0001",
      payerContact: "bob@x.example",
      status: "paid",
    })
    expect(await recipientInvoicesCsv(w.deps, "grace", "tok")).toContain(
      "INV-0001,2026-10-14,2026-10-20,Bob,2× Deck,199.00,239271,paid,2026-10-14,",
    )
    expect(await payView(w.deps, "z".repeat(28))).toBeNull()
  })
  it("a payer can prove payment with the preimage; void and mark-paid need the token and an open invoice", async () => {
    const w = world()
    const c = await createRecipientInvoice(w.deps, "grace", "tok", {
      kind: "request",
      payerName: "Alice",
      items: [{ description: "Dinner", qty: 1, price: "18" }],
    })
    const token = (c as { link: string }).link.split("/pay/")[1] as string
    await payView(w.deps, token) // mints
    const i = (await w.invoices.getByToken(token)) as IssuedInvoice
    const preimage = "ef".repeat(32)
    await w.invoices.update({
      ...i,
      paymentHash: createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex"),
    })
    expect(await claimInvoicePaid(w.deps, token, "00".repeat(32))).toMatchObject({ ok: false })
    expect(await claimInvoicePaid(w.deps, token, preimage)).toEqual({ ok: true })
    expect(await recipientInvoiceAction(w.deps, "grace", "tok", i.id, "void")).toMatchObject({
      ok: false,
      error: "Already paid.",
    })
    const c2 = await createRecipientInvoice(w.deps, "grace", "tok", {
      kind: "request",
      payerName: "Carl",
      items: [{ description: "x", qty: 1, price: "1" }],
    })
    expect(
      await recipientInvoiceAction(w.deps, "grace", "tok", (c2 as { id: string }).id, "mark_paid"),
    ).toEqual({ ok: true })
    expect((await w.invoices.get((c2 as { id: string }).id))?.paidReported).toBe(true)
  })
})
