import { InMemoryPendingStore, type UserContext } from "@agentic-bitcoin/agent"
import {
  FakeGoodsRail,
  FakeWalletRail,
  InMemoryLedgerStore,
  readEntries,
} from "@agentic-bitcoin/core"
import { POLICIES, PRICE, clockAt } from "@agentic-bitcoin/fixtures"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, it } from "vitest"
import { createServer } from "./server"

async function connect() {
  const ledger = new InMemoryLedgerStore()
  const ctx: UserContext = {
    userId: "u1",
    policy: { ...POLICIES.open, confirmAboveSats: 1_000n },
    ledger,
    rails: { wallet: new FakeWalletRail({ balanceSats: 100_000n }), goods: new FakeGoodsRail() },
    pending: new InMemoryPendingStore(),
  }
  const server = createServer({
    resolveContext: async () => ctx,
    price: async () => PRICE,
    now: clockAt(),
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: "test", version: "0" })
  await client.connect(b)
  return { client, ledger, ctx }
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]?.text ?? ""

describe("MCP server", () => {
  it("lists every tool with a JSON schema", async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      "buy_bitcoin",
      "buy_product",
      "cancel_schedule",
      "confirm_action",
      "fetch_l402",
      "get_balance",
      "make_invoice",
      "pay_invoice",
      "pay_lightning_address",
      "schedule_buy",
      "search_products",
    ])
    expect(tools.find((t) => t.name === "pay_lightning_address")?.inputSchema).toMatchObject({
      required: ["address", "amount_sats", "memo"],
    })
  })
  it("executes a read and a small payment through policy and the ledger", async () => {
    const { client, ledger } = await connect()
    const bal = await client.callTool({ name: "get_balance", arguments: {} })
    expect(JSON.parse(text(bal))).toMatchObject({ status: "succeeded", result: { sats: "100000" } })
    const pay = await client.callTool({
      name: "pay_lightning_address",
      arguments: { address: "gm@getalby.com", amount_sats: 21, memo: "" },
    })
    expect(JSON.parse(text(pay)).status).toBe("succeeded")
    expect((await readEntries(ledger)).map((e) => e.outcome)).toEqual(["succeeded", "succeeded"])
  })
  it("parks a large payment, refuses a bad hash, executes on confirm_action", async () => {
    const { client } = await connect()
    const r = await client.callTool({
      name: "pay_lightning_address",
      arguments: { address: "gm@getalby.com", amount_sats: 5_000, memo: "rent" },
    })
    const parsed = JSON.parse(text(r))
    expect(parsed.status).toBe("awaiting_confirmation")
    expect(parsed.summary).toContain("5,000 sats")
    expect(parsed.summary).toContain("$4.15")
    const bad = await client.callTool({
      name: "confirm_action",
      arguments: { action_hash: "0".repeat(64) },
    })
    expect(bad.isError).toBe(true)
    const ok = await client.callTool({
      name: "confirm_action",
      arguments: { action_hash: parsed.action_hash },
    })
    expect(JSON.parse(text(ok)).status).toBe("succeeded")
    const again = await client.callTool({
      name: "confirm_action",
      arguments: { action_hash: parsed.action_hash },
    })
    expect(again.isError).toBe(true) // consumed
  })
  it("returns a typed error for invalid input instead of crashing", async () => {
    const { client } = await connect()
    const r = await client.callTool({
      name: "pay_lightning_address",
      arguments: { address: "x", amount_sats: -1 },
    })
    expect(r.isError).toBe(true)
    expect(text(r)).toContain("invalid_input")
  })
})
