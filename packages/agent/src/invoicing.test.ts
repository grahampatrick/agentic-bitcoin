import {
  FakeWalletRail,
  InMemoryInvoiceStore,
  InMemoryLedgerStore,
  type Policy,
  readEntries,
} from "@agentic-bitcoin/core"
import { PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { InMemoryPendingStore, type UserContext, runTurn } from "./agent"
import { ScriptedLlmClient, intentOf } from "./scripted"
import { ToolInputError, toolToAction } from "./tools"

const policy: Policy = {
  dailyCapSats: 1_000_000n,
  perActionCapSats: 500_000n,
  confirmAboveSats: 1_000_000n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: false, goods: false, compute: false, onchain: false },
}
function world(userId = "u1") {
  const store = new InMemoryInvoiceStore()
  const ledger = new InMemoryLedgerStore()
  let n = 0
  const ctx: UserContext = {
    userId,
    policy,
    ledger,
    rails: { wallet: new FakeWalletRail({ now: () => new Date("2026-10-14T12:00:00.000Z") }) },
    pending: new InMemoryPendingStore(),
    seal: (s) => `sealed(${s.length})`,
    invoices: {
      store,
      issuer: userId,
      issuerName: "GM",
      siteUrl: "https://x.example",
      newId: () => `inv_${++n}`,
    },
    payLinks: {
      resolve: async (token) => {
        const i = await store.getByToken(token)
        return i && i.state === "open" && i.bolt11
          ? { bolt11: i.bolt11, amountSats: i.amountSats ?? 0n, destination: `invoice:${i.issuer}` }
          : null
      },
    },
  }
  const deps = {
    llm: new ScriptedLlmClient(),
    resolveContext: async () => ctx,
    price: async () => PRICE,
    now: () => new Date("2026-10-14T12:00:00.000Z"),
  }
  return { ctx, deps, store, ledger }
}

describe("scripted invoicing intents", () => {
  it("parses invoices, requests, lists, voids and pay links", () => {
    const inv = intentOf("invoice Bob $200 for the deck due friday")
    expect(inv?.name).toBe("create_invoice")
    expect(inv?.input).toMatchObject({
      invoice_kind: "invoice",
      payer_name: "Bob",
      items_json: JSON.stringify([{ description: "the deck", qty: 1, unit_cents: 20000 }]),
    })
    expect(String(inv?.input.due_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(intentOf("request $18 from Alice for dinner")?.input).toMatchObject({
      invoice_kind: "request",
      payer_name: "Alice",
    })
    expect(intentOf("who hasn't paid me?")).toEqual({
      name: "list_invoices",
      input: { filter: "open" },
    })
    expect(intentOf("my paid invoices")).toEqual({
      name: "list_invoices",
      input: { filter: "paid" },
    })
    expect(intentOf("void inv_12")).toEqual({
      name: "void_invoice",
      input: { invoice_id: "inv_12" },
    })
    expect(intentOf(`pay this https://x.example/pay/${"a".repeat(28)}`)?.name).toBe("pay_invoice")
  })
})

describe("create_invoice tool", () => {
  it("validates items and seals the contact; refuses a contact without a seal", () => {
    const base = {
      callId: "c",
      requestedBy: "agent" as const,
      price: PRICE,
      seal: (s: string) => `sealed:${s}`,
    }
    const a = toolToAction(
      "create_invoice",
      {
        invoice_kind: "invoice",
        payer_name: "Bob",
        payer_contact: "bob@x.example",
        items_json: '[{"description":"Deck","qty":2,"unit_cents":10000}]',
        memo: "thanks",
        due_date: "2026-10-17",
      },
      base,
    )
    expect(a).toMatchObject({
      kind: "create_invoice",
      payerName: "Bob",
      payerContactSealed: "sealed:bob@x.example",
      items: [{ description: "Deck", qty: 2, unitCents: 10_000n }],
      dueAt: "2026-10-17T23:59:59.000Z",
    })
    expect(() =>
      toolToAction(
        "create_invoice",
        {
          invoice_kind: "invoice",
          payer_name: "Bob",
          payer_contact: "",
          items_json: "nope",
          memo: "",
          due_date: "",
        },
        base,
      ),
    ).toThrow(ToolInputError)
    expect(() =>
      toolToAction(
        "create_invoice",
        {
          invoice_kind: "invoice",
          payer_name: "",
          payer_contact: "",
          items_json: '[{"description":"x","qty":1,"unit_cents":1}]',
          memo: "",
          due_date: "",
        },
        base,
      ),
    ).toThrow(/who/)
    expect(() =>
      toolToAction(
        "create_invoice",
        {
          invoice_kind: "invoice",
          payer_name: "Bob",
          payer_contact: "bob@x",
          items_json: '[{"description":"x","qty":1,"unit_cents":1}]',
          memo: "",
          due_date: "",
        },
        { ...base, seal: undefined },
      ),
    ).toThrow(/SECRETS_KEY/)
  })
})

describe("invoicing end to end", () => {
  it("issues an invoice with a pay link minted on the user's wallet, lists it, and another user can pay the link through policy", async () => {
    const w = world()
    const r = await runTurn(w.deps, "u1", "invoice Bob $200 for the deck due friday", [])
    expect(r.toolCalls[0]).toEqual({ name: "create_invoice", status: "succeeded" })
    expect(r.reply).toMatch(
      /INV-0001 for \$200\.00 \(240,474 sats\), due \d{4}-\d{2}-\d{2}\. Send them this link: https:\/\/x\.example\/pay\/[a-z0-9]{28}/,
    )
    const link = /https:\/\/x\.example\/pay\/[a-z0-9]{28}/.exec(r.reply)?.[0] ?? ""
    const l = await runTurn(w.deps, "u1", "who hasn't paid me?", [])
    expect(l.reply).toContain("INV-0001 Bob $200.00 — open")
    expect(JSON.stringify(l.history)).toContain("<untrusted>Bob</untrusted>")
    // nothing was spent by issuing
    expect((await readEntries(w.ledger)).every((e) => e.decision.type === "allow")).toBe(true)
    // the payer side: another user with the same link
    const payer = world("u2")
    payer.ctx.payLinks = w.ctx.payLinks
    const p = await runTurn(payer.deps, "u2", `pay this ${link}`, [])
    expect(p.toolCalls[0]).toEqual({ name: "pay_invoice", status: "succeeded" })
    expect(p.reply).toContain("Paid.")
    const bad = await runTurn(
      payer.deps,
      "u2",
      `pay this https://x.example/pay/${"z".repeat(28)}`,
      [],
    )
    expect(bad.toolCalls[0]?.status).toBe("invalid_input")
  })
})
