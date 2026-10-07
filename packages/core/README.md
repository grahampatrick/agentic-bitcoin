# @agentic-bitcoin/core

The domain core: actions, policy engine, ledger, rail contracts, fakes, and the executor.
Pure TypeScript, zero npm dependencies, no I/O. See ADR-0004 (money) and ADR-0005 (policy).

```ts
import {
  DEFAULT_POLICY, FakeWalletRail, InMemoryLedgerStore, execute, type Action,
} from "@agentic-bitcoin/core"

const action: Action = {
  kind: "pay_address", address: "gm@getalby.com", amountSats: 21n,
  idempotencyKey: "tip-2026-10-07-1", requestedBy: "user",
}
const result = await execute({
  action, policy: DEFAULT_POLICY, ledger: new InMemoryLedgerStore(),
  rails: { wallet: new FakeWalletRail() },
  context: { price: { usdCentsPerBtc: 8_316_900n, asOf: new Date().toISOString(), source: "mempool.space" } },
})
// result.status: "succeeded" | "awaiting_confirmation" | "denied" | "failed"
```

When `status` is `awaiting_confirmation`, show `result.decision.summary` to the human and call
`execute` again with `confirmation: { actionHash: result.decision.actionHash, confirmedBy, at }`.

## Contract suite for adapters

```ts
import { describeWalletRail } from "@agentic-bitcoin/core/contract"
describeWalletRail("nwc", () => new NwcWalletRail(cfg), { payable, failing, address })
```

`pnpm --filter @agentic-bitcoin/core test` runs the unit suite plus the contract suite against the fakes.
