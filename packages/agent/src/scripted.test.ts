import { describe, expect, it } from "vitest"
import { intentOf, privateNoteOf, replyFor } from "./scripted"

describe("scripted intents", () => {
  it.each([
    ["what's my balance?", "get_balance", {}],
    [
      "pay 500 sats to gm@getalby.com",
      "pay_lightning_address",
      { address: "gm@getalby.com", amount_sats: 500 },
    ],
    [
      "send gm@getalby.com 2,100 sats for coffee",
      "pay_lightning_address",
      { address: "gm@getalby.com", amount_sats: 2100, memo: "coffee" },
    ],
    ["make an invoice for 10000 sats for lunch", "make_invoice", { amount_sats: 10000 }],
    ["buy $25 of bitcoin", "buy_bitcoin", { usd_cents: 2500 }],
    ["buy $25 of bitcoin every friday", "schedule_buy", { usd_cents: 2500, cron: "0 14 * * 5" }],
    ["every week $100", "schedule_buy", { usd_cents: 10000, cron: "0 14 * * 1" }],
    ["cancel sch_1", "cancel_schedule", { schedule_id: "sch_1" }],
    [
      "get me a $10 amazon gift card",
      "buy_product",
      { product_id: "gift-amazon-us", usd_cents: 1000 },
    ],
    ["what gift cards do you have?", "search_products", {}],
    [
      "fetch https://api.example/x up to 50 sats",
      "fetch_l402",
      { url: "https://api.example/x", max_sats: 50 },
    ],
    [
      "sweep everything above 200000 sats to cold storage bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 max 500000",
      "sweep_to_cold",
      { keep_sats: 200000, max_sats: 500000 },
    ],
    [
      "sweep monthly to bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 keeping 100000",
      "schedule_sweep",
      { keep_sats: 100000, cron: "0 3 1 * *" },
    ],
    [
      "pay my rent, $450 to landlord@example.com on the 1st",
      "schedule_bill",
      {
        name: "rent",
        address: "landlord@example.com",
        usd_cents: 45000,
        amount_sats: 0,
        cron: "0 14 1 * *",
        mode: "auto",
      },
    ],
    [
      "pay phone plan 20,000 sats to bills@carrier.example on the 15th, ask me first",
      "schedule_bill",
      { name: "phone plan", amount_sats: 20000, usd_cents: 0, cron: "0 14 15 * *", mode: "ask" },
    ],
    ["my bills", "list_schedules", {}],
    // M21: "note: X" is private and never the memo; "for X" stays the memo
    [
      "pay 500 sats to gm@getalby.com, note: plumber deposit",
      "pay_lightning_address",
      { address: "gm@getalby.com", amount_sats: 500, memo: "" },
    ],
    [
      "pay 500 sats to gm@getalby.com for coffee, note to self: reimbursed",
      "pay_lightning_address",
      { address: "gm@getalby.com", amount_sats: 500, memo: "coffee" },
    ],
    [
      "add a note to my last payment: reimbursed by work",
      "add_note",
      { text: "reimbursed by work", entry_id: "", match: "" },
    ],
    [
      "note on my payment to gm@getalby.com: plumber",
      "add_note",
      { text: "plumber", entry_id: "", match: "gm@getalby.com" },
    ],
    ["remove the note from my last payment", "add_note", { text: "", entry_id: "", match: "" }],
  ])("%s → %s", (text, name, input) => {
    const i = intentOf(text)
    expect(i?.name).toBe(name)
    expect(i?.input).toMatchObject(input)
  })
  it("returns null for chit-chat and for advice questions (the client answers those with the no-advice line)", () => {
    expect(intentOf("hello there")).toBeNull()
    expect(intentOf("should I buy bitcoin today?")).toBeNull()
  })
})

describe("scripted replies", () => {
  it("relays confirmations, denials and results", () => {
    expect(
      replyFor("pay_lightning_address", {
        status: "awaiting_confirmation",
        summary: "Pay x · 5,000 sats",
      }),
    ).toContain("Reply yes")
    expect(
      replyFor("pay_lightning_address", { status: "denied", reason: "DAILY_CAP", summary: "s" }),
    ).toContain("daily cap")
    expect(replyFor("get_balance", { status: "succeeded", result: { sats: "100000" } })).toBe(
      "Your wallet holds 100,000 sats.",
    )
    expect(replyFor("sweep_to_cold", { status: "succeeded", result: { skipped: true } })).toContain(
      "Nothing to sweep",
    )
  })
})

describe("private notes in the scripted model (M21)", () => {
  it("finds the note a payment carried and leaves plain payments alone", () => {
    expect(privateNoteOf("pay 500 sats to gm@getalby.com, note: plumber deposit")).toBe(
      "plumber deposit",
    )
    expect(privateNoteOf("pay 500 sats to gm@getalby.com note to self: rent share")).toBe(
      "rent share",
    )
    expect(privateNoteOf("pay 500 sats to gm@getalby.com for coffee")).toBeNull()
  })
  it("replies for add_note", () => {
    expect(
      replyFor("add_note", { status: "succeeded", result: { summary: "Pay a@b", cleared: false } }),
    ).toBe("Noted privately on “Pay a@b”; the payee never sees it.")
    expect(replyFor("add_note", { status: "succeeded", result: { cleared: true } })).toBe(
      "Note removed.",
    )
  })
})
