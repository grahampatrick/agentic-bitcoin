/**
 * Demo: one $5 buy on the user's own Strike account through policy → ledger → Strike quote/execute.
 *
 *   STRIKE_API_KEY=… pnpm --filter @agentic-bitcoin/rails demo:dca
 *   DCA_USD_CENTS (default 500). Needs a funded Strike account (plan OQ-3). Nothing is swept.
 */
import {
  type Action,
  DEFAULT_POLICY,
  InMemoryLedgerStore,
  centsToSats,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { StrikeExchangeRail } from "../src/exchange/strike.ts"

const key = process.env.STRIKE_API_KEY
if (!key) {
  console.error(
    "Set STRIKE_API_KEY (scopes: currency-exchange quote create/execute, rates, balances)",
  )
  process.exit(2)
}
const usdCents = BigInt(process.env.DCA_USD_CENTS ?? "500")
const strike = new StrikeExchangeRail({ apiKey: key })
const rate = await strike.getRate()
const price = { usdCentsPerBtc: rate.usdCentsPerBtc, asOf: rate.asOf, source: "strike" }
console.log(
  `rate: ${(rate.usdCentsPerBtc / 100n).toString()} USD/BTC · USD balance ${(await strike.getUsdBalance()) / 100n}`,
) // money-ok: display
const estimatedSats = centsToSats(usdCents, price)
const action: Action = {
  kind: "buy_bitcoin",
  exchange: "strike",
  usdCents,
  estimatedSats,
  idempotencyKey: `demo-dca-${Date.now()}`,
  requestedBy: "user",
}
const ledger = new InMemoryLedgerStore()
const result = await execute({
  action,
  policy: {
    ...DEFAULT_POLICY,
    rails: { ...DEFAULT_POLICY.rails, exchange: true },
    perActionCapSats: estimatedSats * 2n,
    confirmAboveSats: estimatedSats * 2n + 1n,
  },
  ledger,
  rails: { exchange: strike },
  context: { price },
})
console.log(`result: ${result.status}`)
if (result.status === "succeeded")
  console.log(
    "execution:",
    JSON.stringify(result.result, (_k, v) => (typeof v === "bigint" ? `${v}` : v)),
  )
else if (result.status === "failed") console.error(`error: ${result.code ?? ""} ${result.error}`)
const [entry] = await readEntries(ledger)
console.log("ledger:", entry?.outcome, "·", entry?.detail ?? entry?.error ?? "")
process.exit(result.status === "succeeded" ? 0 : 1)
