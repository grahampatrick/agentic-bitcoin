import { describe, expect, it } from "vitest"
import { intentOf, replyFor } from "./scripted"

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
