/**
 * Terminal showcase: a fixed conversation through the sandbox (fake sats; real policy engine,
 * executor, ledger, confirmation protocol). No credentials. With ANTHROPIC_API_KEY set, the real
 * model understands the messages; otherwise the scripted model does.
 *
 *   pnpm demo
 */
import { AnthropicLlmClient } from "../src/llm.ts"
import { SANDBOX_COLD_ADDRESS, initialSandbox, sandboxTurn } from "../src/sandbox.ts"
import { ScriptedLlmClient } from "../src/scripted.ts"

const live = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
const llm = live ? new AnthropicLlmClient() : new ScriptedLlmClient()
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

console.log(bold("Agentic Bitcoin — sandbox demo"))
console.log(
  dim(
    `model: ${live ? "Claude Opus 5.5 (live)" : "scripted (no API key)"} · wallet 250,000 sats · cold storage registered · daily cap 100,000 · confirm above 5,000\n`,
  ),
)

const script = [
  "what's my balance?",
  "pay 500 sats to gm@getalby.com for coffee",
  "send 20000 sats to friend@walletofsatoshi.com",
  "yes",
  "pay 60000 sats to gm@getalby.com",
  "get me a $10 amazon gift card",
  "yes",
  "buy $25 of bitcoin every friday",
  "yes",
  "fetch https://api.example/answer up to 50 sats",
  `sweep everything above 200000 sats to cold storage ${SANDBOX_COLD_ADDRESS} max 50000`,
  "yes",
  "should I buy more bitcoin today?",
]

let state = initialSandbox()
for (const line of script) {
  console.log(`${bold("you ›")} ${line}`)
  const t = await sandboxTurn(llm, state, line)
  console.log(`${bold("bot ›")} ${t.reply}`)
  for (const d of t.deliveries) console.log(`${bold("bot ›")} ${d}`)
  const last = t.ledger.at(-1)
  if (t.toolCalls.length)
    console.log(
      dim(
        `      ledger: ${t.ledger.length} rows · last ${last?.outcome} · ${last?.decision.summary} · wallet ${Number(t.state.walletSats).toLocaleString("en-US")} sats`,
      ),
    )
  console.log()
  state = t.state
}
console.log(
  dim(
    "Every row above went through: policy → (confirmation) → rail → ledger. Nothing bypasses the executor.",
  ),
)
