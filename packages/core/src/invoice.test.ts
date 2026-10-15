import { PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { execute } from "./executor"
import { FakeWalletRail } from "./fakes"
import {
  InMemoryInvoiceStore,
  invoiceStatus,
  invoicesCsv,
  payLinkFor,
  tokenFromPayLink,
} from "./invoice"
import { InMemoryLedgerStore, readEntries } from "./ledger"
import { DEFAULT_POLICY } from "./policy"

const now = () => new Date("2026-10-14T12:00:00.000Z")

describe("invoice helpers", () => {
  it("derives overdue/expired, round-trips pay links", () => {
    const base = {
      id: "i",
      number: "INV-0001",
      issuer: "u1",
      kind: "invoice" as const,
      payerName: "Bob",
      items: [],
      totalCents: 1n,
      state: "open" as const,
      token: "a".repeat(28),
      createdAt: "t",
    }
    expect(invoiceStatus({ ...base, dueAt: "2026-10-01T00:00:00.000Z" }, now())).toBe("overdue")
    expect(invoiceStatus({ ...base, expiresAt: "2026-10-01T00:00:00.000Z" }, now())).toBe("expired")
    expect(invoiceStatus({ ...base, state: "paid" }, now())).toBe("paid")
    expect(tokenFromPayLink(payLinkFor("https://x.example/", "b".repeat(28)))).toBe("b".repeat(28))
    expect(tokenFromPayLink("pay https://x.example/pay/short")).toBeNull()
  })
})

describe("create / list / void through the executor", () => {
  it("mints on the issuer's wallet, stores a pay link, lists by status, voids unpaid only; nothing is spent", async () => {
    const store = new InMemoryInvoiceStore()
    const ledger = new InMemoryLedgerStore()
    const wallet = new FakeWalletRail({ now })
    const ctx = {
      policy: DEFAULT_POLICY,
      ledger,
      rails: { wallet },
      now,
      context: { price: PRICE },
      invoices: {
        store,
        issuer: "u1",
        issuerName: "GM",
        siteUrl: "https://x.example",
        newId: () => "inv_1",
      },
    }
    const r = await execute({
      ...ctx,
      action: {
        kind: "create_invoice",
        idempotencyKey: "k1",
        requestedBy: "agent",
        invoiceKind: "invoice",
        payerName: "Bob",
        items: [{ description: "Deck", qty: 1, unitCents: 20_000n }],
        dueAt: "2026-10-17T00:00:00.000Z",
      },
    })
    expect(r.status).toBe("succeeded")
    const res = (r as { result: { link: string; amountSats: bigint; number: string } }).result
    expect(res.number).toBe("INV-0001")
    expect(res.link).toMatch(/^https:\/\/x\.example\/pay\/[a-z0-9]{28}$/)
    expect(res.amountSats).toBe(240_474n)
    const inv = await store.get("inv_1")
    expect(inv).toMatchObject({
      state: "open",
      bolt11: expect.stringMatching(/^lnbc/),
      amountSats: 240_474n,
      totalCents: 20_000n,
    })
    const list = await execute({
      ...ctx,
      action: { kind: "list_invoices", idempotencyKey: "k2", requestedBy: "agent", filter: "open" },
    })
    expect(
      (list as { result: { invoices: { number: string; status: string }[] } }).result.invoices,
    ).toEqual([expect.objectContaining({ number: "INV-0001", status: "open" })])
    const v = await execute({
      ...ctx,
      action: {
        kind: "void_invoice",
        idempotencyKey: "k3",
        requestedBy: "agent",
        invoiceId: "inv_1",
      },
    })
    expect(v.status).toBe("succeeded")
    expect((await store.get("inv_1"))?.state).toBe("void")
    const other = await execute({
      ...ctx,
      invoices: { ...ctx.invoices, issuer: "u2" },
      action: {
        kind: "void_invoice",
        idempotencyKey: "k4",
        requestedBy: "agent",
        invoiceId: "inv_1",
      },
    })
    expect(other.status).toBe("failed")
    const entries = await readEntries(ledger)
    expect(entries.every((e) => e.decision.type === "allow")).toBe(true)
    expect(invoicesCsv(await store.listForIssuer("u1"), now())).toContain(
      "INV-0001,2026-10-14,2026-10-17,Bob,1× Deck,200.00,240474,void,,",
    )
  })
})
