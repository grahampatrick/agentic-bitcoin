# @agentic-bitcoin/fixtures

One source of truth for test data: actions, policies, synthetic invoices, an L402 challenge, a
Strike quote and a Bitrefill invoice shape, and a fixed price snapshot (`$83,169/BTC`).

```ts
import { ACTIONS, POLICIES, PRICE, INVOICES, clockAt } from "@agentic-bitcoin/fixtures"
```

Rules: deterministic, no secrets, Lightning strings are synthetic (`lnbc…fixture…`). Real regtest
vectors arrive in M2 **alongside** these, never replacing them.
