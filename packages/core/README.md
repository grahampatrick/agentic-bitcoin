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

## The desk: views and settings (M25, ADR-0029)

`show` and `change_setting` are ordinary Actions. The pure half is in `desk.ts`:

```ts
import { applyPolicySetting, describeSetting, settingNarrows } from "@agentic-bitcoin/core"

const change = { setting: "daily_cap", op: "set", value: "20000", name: "" } as const
settingNarrows(change, policy)   // true: lower than today, so it applies without a yes
describeSetting(change, policy)  // "Set your daily cap to 20,000 sats (now 100,000 sats)"
applyPolicySetting(policy, change) // { ok: true, policy, text } · { ok: false, error } · null (needs a store)
```

`evaluate` allows a narrowing change and answers `needs_confirmation` for anything else; neither
kind is gated by the kill switch or a rail switch. The executor reaches the stores through the
`desk` hook (`show`, `check`, `change`) on `ExecuteInput`; without one the action fails.
