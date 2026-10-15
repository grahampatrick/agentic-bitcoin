import {
  FakeWalletRail,
  InMemoryInvoiceStore,
  InMemoryLedgerStore,
  type Policy,
  readEntries,
} from "@agentic-bitcoin/core"
import { PRICE } from "@agentic-bitcoin/fixtures"
import { describe, expect, it } from "vitest"
import { runDue, schedulesHook } from "./runner"
import { InMemoryScheduleStore } from "./schedule"

const policy: Policy = {
  dailyCapSats: 1n,
  perActionCapSats: 1n,
  confirmAboveSats: 1n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: false, goods: false, compute: false, onchain: false },
}

describe("recurring invoices (M14)", () => {
  it("a create_invoice with a cron becomes a schedule; each firing issues a fresh invoice due later", async () => {
    const schedules = new InMemoryScheduleStore()
    const hook = schedulesHook(schedules, { userId: "u1" })
    const id = await hook.create({
      kind: "create_invoice",
      idempotencyKey: "u1:c",
      requestedBy: "agent",
      invoiceKind: "invoice",
      payerName: "Grace Church",
      items: [{ description: "Sound tech, monthly", qty: 1, unitCents: 50_000n }],
      cron: "0 14 1 * *",
      dueDays: 10,
    })
    expect((await hook.list())[0]?.summary).toBe("Invoice Grace Church (Sound tech, monthly)")
    const store = new InMemoryInvoiceStore()
    const ledger = new InMemoryLedgerStore()
    const firstOfMonth = new Date("2026-11-01T14:00:10.000Z")
    const report = await runDue({
      schedules,
      resolve: async () => ({
        policy,
        ledger,
        rails: { wallet: new FakeWalletRail({ now: () => firstOfMonth }) },
        invoices: { store, issuer: "u1", siteUrl: "https://x.example", newId: () => "inv_1" },
      }),
      price: async () => PRICE,
      now: () => firstOfMonth,
    })
    expect(report.fired[0]?.status).toBe("succeeded")
    expect(report.fired[0]?.detail).toMatch(/^issued INV-0001 https:\/\/x\.example\/pay\//)
    const inv = await store.get("inv_1")
    expect(inv).toMatchObject({
      payerName: "Grace Church",
      totalCents: 50_000n,
      state: "open",
      dueAt: "2026-11-11T14:00:10.000Z",
    })
    expect((await readEntries(ledger))[0]?.action).toMatchObject({
      kind: "create_invoice",
      requestedBy: "schedule",
    })
    void id
  })
})
