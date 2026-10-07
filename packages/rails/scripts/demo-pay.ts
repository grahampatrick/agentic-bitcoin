/**
 * Demo: "pay 21 sats to a lightning address" end-to-end through policy → ledger → NWC.
 *
 *   NWC_URL='nostr+walletconnect://…' NWC_TEST_ADDRESS='gm@getalby.com' pnpm --filter @agentic-bitcoin/rails demo:pay
 */
import {
  type Action,
  DEFAULT_POLICY,
  InMemoryLedgerStore,
  type Policy,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { NwcWalletRail, describeConnectionString } from "../src/wallet/nwc.ts"

const url = process.env.NWC_URL
const address = process.env.NWC_TEST_ADDRESS ?? "gm@getalby.com"
if (!url) {
  console.error("Set NWC_URL to a budgeted nostr+walletconnect:// string (see docs/testing.md)")
  process.exit(2)
}

const wallet = new NwcWalletRail({ connectionString: url })
console.log(`wallet: ${describeConnectionString(url)}`)

const info = await wallet.describeConnection()
console.log(`alias: ${info.alias ?? "?"} · network: ${info.network ?? "?"}`)
if (info.budget) {
  console.log(
    `budget: ${info.budget.usedSats}/${info.budget.totalSats} sats (${info.budget.renewal})`,
  )
} else {
  console.warn("WARNING: this connection reports NO budget. Use a budgeted, expiring connection.")
}
console.log(`balance: ${(await wallet.getBalance()).sats} sats`)

const policy: Policy = { ...DEFAULT_POLICY, confirmAboveSats: 1_000n }
const ledger = new InMemoryLedgerStore()
const action: Action = {
  kind: "pay_address",
  address,
  amountSats: 21n,
  memo: "agentic-bitcoin demo",
  idempotencyKey: `demo-${Date.now()}`,
  requestedBy: "user",
}

const result = await execute({ action, policy, ledger, rails: { wallet } })
console.log(`result: ${result.status}`)
if (result.status === "succeeded") {
  const r = result.result as { preimage: string; feeSats: bigint }
  console.log(`preimage: ${r.preimage}`)
  console.log(`fee: ${r.feeSats} sats`)
}
if (result.status === "failed") console.error(`error: ${result.code ?? ""} ${result.error}`)
const [entry] = await readEntries(ledger)
console.log(
  "ledger:",
  JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? `${v}n` : v), 2),
)
wallet.close()
process.exit(result.status === "succeeded" ? 0 : 1)
