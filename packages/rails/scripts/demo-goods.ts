/**
 * Demo: buy the cheapest sensible item on Bitrefill with sats from the NWC wallet, through
 * policy → confirmation → wallet → poll → sealed ledger entry. Prints a MASKED code.
 *
 *   BITREFILL_API_KEY=… NWC_URL=… pnpm --filter @agentic-bitcoin/rails demo:goods
 *   GOODS_QUERY (default "amazon"), GOODS_PRODUCT_ID (skip search), GOODS_USD_CENTS (default 500), SECRETS_KEY (optional, seals the code)
 */
import {
  type Action,
  DEFAULT_POLICY,
  InMemoryLedgerStore,
  actionHash,
  centsToSats,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { BitrefillGoodsRail } from "../src/goods/bitrefill.ts"
import { encryptSecret, maskSecret, parseKey } from "../src/secrets/index.ts"
import { NwcWalletRail, describeConnectionString } from "../src/wallet/nwc.ts"

const key = process.env.BITREFILL_API_KEY
const nwc = process.env.NWC_URL
if (!key || !nwc) {
  console.error("Set BITREFILL_API_KEY and NWC_URL (see docs/testing.md)")
  process.exit(2)
}
const goods = new BitrefillGoodsRail({ apiKey: key })
const wallet = new NwcWalletRail({ connectionString: nwc })
console.log(
  `wallet: ${describeConnectionString(nwc)} · balance ${(await wallet.getBalance()).sats} sats`,
)

let productId = process.env.GOODS_PRODUCT_ID
if (!productId) {
  const found = await goods.searchProducts(process.env.GOODS_QUERY ?? "amazon")
  console.log(
    "products:",
    found
      .slice(0, 5)
      .map((p) => `${p.id} — ${p.name}`)
      .join("\n          "),
  )
  productId = found[0]?.id
  if (!productId) {
    console.error("no products found")
    process.exit(1)
  }
}
const usdCents = BigInt(process.env.GOODS_USD_CENTS ?? "500")
const priceRes = await fetch("https://mempool.space/api/v1/prices").then(
  (r) => r.json() as Promise<{ USD: number }>,
)
const price = {
  usdCentsPerBtc: BigInt(Math.round(priceRes.USD * 100)),
  asOf: new Date().toISOString(),
  source: "mempool.space",
} // money-ok: boundary
const est = centsToSats(usdCents, price)
const action: Action = {
  kind: "buy_product",
  merchant: "bitrefill",
  productId,
  description: `${productId} $${usdCents / 100n}`, // money-ok: display
  usdCents,
  amountSats: est + est / 20n + 50n, // 5% headroom for merchant fees
  idempotencyKey: `demo-goods-${Date.now()}`,
  requestedBy: "user",
}
const ledger = new InMemoryLedgerStore()
const secretsKey = process.env.SECRETS_KEY ? parseKey(process.env.SECRETS_KEY) : null
const base = {
  policy: {
    ...DEFAULT_POLICY,
    perActionCapSats: action.amountSats,
    dailyCapSats: action.amountSats,
  },
  ledger,
  rails: { wallet, goods },
  context: { price },
  seal: secretsKey ? (s: string) => encryptSecret(s, secretsKey) : undefined,
}
const first = await execute({ action, ...base })
if (first.status !== "awaiting_confirmation") {
  console.error("unexpected:", first.status, "error" in first ? first.error : "")
  process.exit(1)
}
console.log(`CONFIRM? ${first.decision.summary}`)
console.log("(demo auto-confirms in 5s — Ctrl-C to abort)")
await new Promise((r) => setTimeout(r, 5000))
const res = await execute({
  action,
  ...base,
  confirmation: {
    actionHash: actionHash(action),
    confirmedBy: "demo",
    at: new Date().toISOString(),
  },
})
console.log(`result: ${res.status}`)
if (res.status === "succeeded") {
  const o = (res.result as { order: { orderId: string; state: string; redemption?: string } }).order
  console.log(
    `order ${o.orderId}: ${o.state}${o.redemption ? ` · code ${maskSecret(o.redemption)}` : " (not delivered yet — ask the merchant later)"}`,
  )
} else if (res.status === "failed") console.error(`error: ${res.code ?? ""} ${res.error}`)
const entry = (await readEntries(ledger)).find((e) => e.outcome !== "awaiting_confirmation")
console.log(
  `ledger ${entry?.id}: ${entry?.outcome} · ${entry?.detail ?? entry?.error ?? ""} · sealed=${entry?.sealed ? "yes" : "no"}`,
)
wallet.close()
process.exit(res.status === "succeeded" ? 0 : 1)
