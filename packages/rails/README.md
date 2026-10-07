# @agentic-bitcoin/rails

Real adapters for the core rail contracts. Each one passes the contract suite from
`@agentic-bitcoin/core/contract`; the live runs are opt-in and env-gated so CI never moves money.

| Rail | Adapter | Status |
|---|---|---|
| wallet | `NwcWalletRail` (Nostr Wallet Connect via `@getalby/sdk`) | M2 ✓ |
| wallet | `createBreezWalletRail` | stub (ADR-0006) |
| compute | L402 client | M4 |
| exchange | Strike | M5 |
| goods | Bitrefill | M6 |

```ts
import { NwcWalletRail } from "@agentic-bitcoin/rails"
const wallet = new NwcWalletRail({ connectionString: process.env.NWC_URL })
await wallet.describeConnection()   // { alias, network, methods, budget } — never the secret
```

What the NWC adapter guarantees beyond the policy engine: the bolt11 is decoded and must match
the approved amount; payments are idempotent per key and recovered by payment hash after a crash;
a timeout surfaces `UNKNOWN_STATE` (ledger stays pending) instead of a false failure; connection
strings are redacted from every error.

## Secrets

```ts
import { encryptSecret, decryptSecret, parseKey } from "@agentic-bitcoin/rails/secrets"
const key = parseKey(process.env.SECRETS_KEY)      // 32 bytes, hex or base64
const blob = encryptSecret(nwcUrl, key)             // "v1.<iv>.<tag>.<ct>", AES-256-GCM
```

## Live tests and demo

See [`docs/testing.md`](../../docs/testing.md).

```bash
NWC_URL=… NWC_TEST_ADDRESS=… pnpm --filter @agentic-bitcoin/rails test:wallet
NWC_URL=… pnpm --filter @agentic-bitcoin/rails demo:pay
```
