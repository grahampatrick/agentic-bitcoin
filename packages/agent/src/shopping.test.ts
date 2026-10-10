import {
  FakeWalletRail,
  InMemoryLedgerStore,
  InMemoryOrderStore,
  InMemoryProductStore,
  InMemoryRecipientStore,
  type Policy,
  type Recipient,
  type ShopProduct,
  readEntries,
  recipientsForUser,
} from "@agentic-bitcoin/core"
import { PRICE, RECIPIENTS, SHOP } from "@agentic-bitcoin/fixtures"
import {
  CompositeGoodsRail,
  DirectoryGoodsRail,
  decryptSecret,
  encryptSecret,
  parseKey,
} from "@agentic-bitcoin/rails"
import { describe, expect, it } from "vitest"
import { InMemoryPendingStore, type UserContext, runTurn } from "./agent"
import { ScriptedLlmClient, intentOf } from "./scripted"
import { ToolInputError, toolToAction } from "./tools"

const KEY = parseKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
const NWC = `nostr+walletconnect://${"a".repeat(64)}?relay=wss://relay.example.com&secret=${"b".repeat(64)}`
const policy: Policy = {
  dailyCapSats: 10_000_000n,
  perActionCapSats: 5_000_000n,
  confirmAboveSats: 10_000_000n,
  allowDestinations: [],
  denyDestinations: [],
  coldStorageAddresses: [],
  killSwitch: false,
  rails: { wallet: true, exchange: false, goods: true, compute: false, onchain: false },
}
const merchants = (Object.values(SHOP.merchants) as unknown as Recipient[]).map((m) => ({
  ...m,
  nwcReceive: encryptSecret(NWC, KEY),
}))

function world() {
  const products = new InMemoryProductStore(SHOP.products as unknown as ShopProduct[])
  const orders = new InMemoryOrderStore()
  const directory = new InMemoryRecipientStore([...Object.values(RECIPIENTS), ...merchants])
  const ledger = new InMemoryLedgerStore()
  const rail = new DirectoryGoodsRail({
    products,
    orders,
    merchant: (slug) => directory.get(slug),
    price: async () => PRICE,
    secretsKey: KEY,
    walletFor: () => ({
      makeInvoice: async (i: { amountSats: bigint }) => ({
        bolt11: `lnbc${i.amountSats}minted`,
        paymentHash: `${i.amountSats}`.padStart(64, "0"),
        amountSats: i.amountSats,
        expiresAt: "",
      }),
      close() {},
    }),
    siteUrl: "https://x.example",
    buyerKey: "buyer-u1",
  })
  const ctx: UserContext = {
    userId: "u1",
    policy,
    ledger,
    rails: { wallet: new FakeWalletRail(), goods: new CompositeGoodsRail(rail) },
    pending: new InMemoryPendingStore(),
    recipients: recipientsForUser(directory, "u1"),
    seal: (s) => encryptSecret(s, KEY),
    delivery: { pollMs: 1, maxPolls: 3, sleep: async () => {} },
  }
  const llm = new ScriptedLlmClient()
  const deps = {
    llm,
    resolveContext: async () => ctx,
    price: async () => PRICE,
    now: () => new Date("2026-10-10T12:00:00.000Z"),
  }
  return { ctx, deps, orders, ledger }
}

describe("scripted shopping intents", () => {
  it("finds in the store, buys by id with shipping, leaves giving and gift cards alone", () => {
    expect(intentOf("find me a study bible")).toEqual({
      name: "search_products",
      input: { merchant: "directory", query: "study bible" },
    })
    expect(intentOf("do you have any hoodies in the store?")?.name).toBe("search_products")
    expect(intentOf("find a church in denver")?.name).toBe("find_recipient")
    expect(intentOf("get me a $25 amazon gift card")?.name).toBe("buy_product")
    expect(intentOf("buy dir:reformation-books:greek-syntax-ebook for $19.99")).toMatchObject({
      name: "buy_product",
      input: {
        merchant: "directory",
        product_id: "dir:reformation-books:greek-syntax-ebook",
        usd_cents: 1999,
        ship_name: "",
      },
    })
    expect(
      intentOf(
        "buy dir:reformation-books:esv-study-bible for $39.99 ship to Graham, 1 Main St, Denver, CO, 80202, US",
      ),
    ).toMatchObject({
      name: "buy_product",
      input: {
        ship_name: "Graham",
        ship_address: "1 Main St",
        ship_city: "Denver",
        ship_region: "CO",
        ship_postal: "80202",
        ship_country: "US",
      },
    })
  })
})

describe("buy_product → Action seals shipping", () => {
  const base = {
    callId: "u1:c",
    requestedBy: "agent" as const,
    price: PRICE,
    seal: (s: string) => encryptSecret(s, KEY),
  }
  const input = (over: Record<string, unknown> = {}) => ({
    merchant: "directory",
    product_id: "dir:reformation-books:esv-study-bible",
    description: "ESV Study Bible",
    usd_cents: 3999,
    ship_name: "Graham",
    ship_address: "1 Main St",
    ship_city: "Denver",
    ship_region: "CO",
    ship_postal: "80202",
    ship_country: "us",
    contact: "g@example.com",
    ...over,
  })
  it("never carries plaintext; the merchant can open the seal", () => {
    const a = toolToAction("buy_product", input(), base)
    expect(a).toMatchObject({ kind: "buy_product", merchant: "directory", usdCents: 3999n })
    const s = JSON.stringify(a, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
    expect(s).not.toContain("Main St")
    expect(s).not.toContain("g@example.com")
    const ship = JSON.parse(decryptSecret((a as { shippingSealed: string }).shippingSealed, KEY))
    expect(ship).toEqual({
      name: "Graham",
      address: "1 Main St",
      city: "Denver",
      region: "CO",
      postal: "80202",
      country: "US",
    })
    expect(decryptSecret((a as { contactSealed: string }).contactSealed, KEY)).toBe("g@example.com")
  })
  it("rejects partial addresses and refuses to hold an address without a seal", () => {
    expect(() => toolToAction("buy_product", input({ ship_city: "" }), base)).toThrow(
      ToolInputError,
    )
    expect(() => toolToAction("buy_product", input(), { ...base, seal: undefined })).toThrow(
      /SECRETS_KEY/,
    )
    const digital = toolToAction(
      "buy_product",
      input({
        ship_name: "",
        ship_address: "",
        ship_city: "",
        ship_region: "",
        ship_postal: "",
        ship_country: "",
        contact: "",
      }),
      { ...base, seal: undefined },
    )
    expect((digital as { shippingSealed?: string }).shippingSealed).toBeUndefined()
  })
})

describe("shopping end to end through the agent loop", () => {
  it("search shows store links with titles as untrusted data; a physical purchase needs confirmation, then the order is paid and sealed", async () => {
    const w = world()
    const f = await runTurn(w.deps, "u1", "find me a study bible", [])
    expect(f.toolCalls[0]).toEqual({ name: "search_products", status: "succeeded" })
    expect(f.reply).toContain("dir:reformation-books:esv-study-bible")
    expect(f.reply).toContain("https://x.example/shop/p/reformation-books/esv-study-bible")
    expect(JSON.stringify(f.history)).toContain("<untrusted>ESV Study Bible")

    const noShip = await runTurn(
      w.deps,
      "u1",
      "buy dir:reformation-books:esv-study-bible for $39.99",
      [],
    )
    expect(noShip.toolCalls[0]).toEqual({ name: "buy_product", status: "awaiting_confirmation" })
    const yes1 = await runTurn(w.deps, "u1", "yes", [])
    void yes1
    // the executor refused: physical goods need a shipping address (REJECTED by the rail)
    const entries = await readEntries(w.ledger)
    expect(entries.at(-1)?.outcome).toBe("awaiting_confirmation")

    const withShip = await runTurn(
      w.deps,
      "u1",
      "buy dir:reformation-books:esv-study-bible for $39.99 ship to Graham, 1 Main St, Denver, CO, 80202, US",
      [],
    )
    expect(withShip.toolCalls[0]).toEqual({ name: "buy_product", status: "awaiting_confirmation" })
    expect(withShip.pending?.summary).not.toContain("Main St")
    const { confirmPending } = await import("./agent")
    const out = await confirmPending(w.ctx, withShip.pending?.actionHash ?? "", {
      confirmedBy: "u1",
      price: PRICE,
      now: () => new Date(),
    })
    expect(out.status).toBe("succeeded")
    const [order] = await w.orders.listForBuyer("buyer-u1")
    expect(order).toMatchObject({
      state: "paid",
      merchantSlug: "reformation-books",
      totalCents: 39_99n,
    })
    expect(order?.shippingSealed).toBeDefined()
    expect(
      JSON.stringify(order?.items, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    ).not.toContain("Main St")
    expect(JSON.parse(decryptSecret(order?.shippingSealed ?? "", KEY)).city).toBe("Denver")
    const ledger = await readEntries(w.ledger)
    expect(
      JSON.stringify(ledger, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    ).not.toContain("Main St")
  })
})
