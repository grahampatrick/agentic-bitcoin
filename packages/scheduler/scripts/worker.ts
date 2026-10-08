/**
 * Dev worker: polls `runDue` against in-memory stores with fake rails, so the scheduler can be
 * watched end-to-end with no credentials:
 *
 *   pnpm --filter @agentic-bitcoin/scheduler worker     # creates "$1 every minute", fires twice, cancels, exits
 *
 * Production wiring (per-user Supabase stores, Strike rail, NWC sweep) is in apps/bot.
 */
import {
  DEFAULT_POLICY,
  FakeExchangeRail,
  InMemoryLedgerStore,
  type Policy,
  readEntries,
} from "@agentic-bitcoin/core"
import { InMemoryScheduleStore, runDue, schedulesHook } from "../src/index.ts"

const policy: Policy = {
  ...DEFAULT_POLICY,
  rails: { ...DEFAULT_POLICY.rails, exchange: true },
  confirmAboveSats: 1_000_000n,
}
const store = new InMemoryScheduleStore()
const ledger = new InMemoryLedgerStore()
const exchange = new FakeExchangeRail({ balanceCents: 100_00n })
const hook = schedulesHook(store)
const id = await hook.create({
  kind: "schedule_buy",
  exchange: "strike",
  usdCents: 100n,
  cron: "* * * * *",
  estimatedSats: 1_202n,
  idempotencyKey: "dev:1",
  requestedBy: "user",
})
console.log(`created ${id}: $1.00 every minute. Watching… (Ctrl-C to stop early)`)

let fired = 0
const tick = async () => {
  const r = await runDue({
    schedules: store,
    resolve: async () => ({ policy, ledger, rails: { exchange } }),
    price: async () => undefined,
    log: (l) => console.log(new Date().toISOString(), l),
  })
  fired += r.fired.length
  if (fired >= 2) {
    await hook.cancel(id)
    const entries = await readEntries(ledger)
    console.log(
      `cancelled after ${fired} runs · ledger: ${entries.map((e) => `${e.action.requestedBy}/${e.outcome}`).join(", ")}`,
    )
    const after = await runDue({
      schedules: store,
      resolve: async () => ({ policy, ledger, rails: { exchange } }),
      price: async () => undefined,
    })
    console.log(`after cancel: ${after.fired.length} fired`)
    process.exit(0)
  }
}
await tick()
setInterval(tick, Number(process.env.WORKER_POLL_MS ?? 10_000))
