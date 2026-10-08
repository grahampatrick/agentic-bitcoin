/**
 * Demo: buy inference with sats. Policy → wallet (NWC) → L402 against a Lightning-paid LLM endpoint.
 *
 *   NWC_URL='nostr+walletconnect://…' pnpm --filter @agentic-bitcoin/rails demo:compute
 *   L402_URL is REQUIRED (llm402.ai from early research does not resolve; LightningProx or an Aperture route works). L402_MAX_SATS (default 100), L402_BODY (JSON)
 */
import {
  type Action,
  DEFAULT_POLICY,
  InMemoryLedgerStore,
  execute,
  readEntries,
} from "@agentic-bitcoin/core"
import { L402ComputeRail, hostOf } from "../src/compute/l402.ts"
import { NwcWalletRail, describeConnectionString } from "../src/wallet/nwc.ts"

const nwcUrl = process.env.NWC_URL
if (!nwcUrl) {
  console.error("Set NWC_URL to a budgeted nostr+walletconnect:// string (see docs/testing.md)")
  process.exit(2)
}
const url = process.env.L402_URL
if (!url) {
  console.error(
    "Set L402_URL to a Lightning-paid (L402) endpoint, e.g. a LightningProx or Aperture route",
  )
  process.exit(2)
}
const maxSats = BigInt(process.env.L402_MAX_SATS ?? "100")
const body =
  process.env.L402_BODY ??
  JSON.stringify({
    model: "llama-3.1-8b-instruct",
    messages: [{ role: "user", content: "In one sentence: what is a satoshi?" }],
    max_tokens: 60,
  })

const wallet = new NwcWalletRail({ connectionString: nwcUrl })
console.log(
  `wallet: ${describeConnectionString(nwcUrl)} · balance ${(await wallet.getBalance()).sats} sats`,
)
console.log(`endpoint: ${url} · ceiling ${maxSats} sats`)

const action: Action = {
  kind: "pay_l402",
  url,
  host: hostOf(url),
  amountSats: maxSats,
  method: "POST",
  body,
  headers: { "content-type": "application/json" },
  idempotencyKey: `demo-compute-${Date.now()}`,
  requestedBy: "user",
}
const ledger = new InMemoryLedgerStore()
const result = await execute({
  action,
  policy: { ...DEFAULT_POLICY, perActionCapSats: maxSats, confirmAboveSats: maxSats + 1n },
  ledger,
  rails: { wallet, compute: new L402ComputeRail() },
})
console.log(`result: ${result.status}`)
if (result.status === "succeeded") {
  const r = result.result as { status: number; body: string }
  console.log(`HTTP ${r.status}\n${r.body.slice(0, 800)}`)
} else if (result.status === "failed") console.error(`error: ${result.code ?? ""} ${result.error}`)
const [entry] = await readEntries(ledger)
console.log("ledger:", entry?.outcome, "·", entry?.detail ?? entry?.error ?? "")
wallet.close()
process.exit(result.status === "succeeded" ? 0 : 1)
