# ADR-0012: Sweeps go only to a registered cold-storage address, and always ask

**Date:** 2026-10-08 · **Status:** accepted · Implemented in `packages/core/src/{address,policy,executor}.ts`, `packages/rails/src/onchain/lnd.ts`, `packages/scheduler`

## Decision
- `sweep_to_cold` moves confirmed on-chain balance above `keepSats` to an address, capped by
  `maxSats` per run; amounts under 10,000 sats are skipped as dust. `schedule_sweep` makes it
  recurring (monthly is the expected cadence).
- The destination must be an address the user registered with `/cold`, which validates it
  (bech32/bech32m/base58check, dependency-free) and stores it in `policy.coldStorageAddresses`, a
  list separate from `allowDestinations` so registering cold storage does not restrict ordinary
  payments. The policy engine denies a sweep to any other address, so a prompt injection cannot
  name a new one. The executor re-validates the address
  before touching the rail.
- A sweep always needs a human yes, like a purchase. A scheduled sweep was confirmed when the
  schedule was created; each firing carries a confirmation bound to the generated action, and the
  address is re-checked against the allow list at fire time (removing it with `/cold remove`
  stops future sweeps).
- The on-chain rail is `OnChainRail` (balance + send, idempotent per key). The first adapter is
  **LND REST** with a macaroon baked for `onchain:read` + `onchain:write` only, never admin. The
  fee is derived from the balance delta because the endpoint does not report it. NWC has no
  on-chain method, so the Lightning wallet and the on-chain wallet are separate rails.
- The on-chain rail is off in `DEFAULT_POLICY`; `/budget rail onchain on` enables it.
- Watch-only xpub tracking (deriving fresh addresses per sweep) is **not** implemented: a single
  registered address is reused. Address reuse is a privacy cost the user accepts explicitly; xpub
  support is a later step and would plug into the same `/cold` flow.

## Why
Cold storage is where the money ends up; a mistake here is permanent. Restricting destinations
to pre-registered, validated addresses removes the model from the one decision that cannot be
undone, and keeps the executor the only path for broadcasting.

## Consequences
- Per-user LND credentials are a later addition; the bot and MCP CLI read operator-level
  `LND_REST_URL` / `LND_MACAROON_HEX` today.
- `/ledger` shows sweeps with the txid prefix; nothing is swept without a row.
