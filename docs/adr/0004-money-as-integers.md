# ADR-0004: Money is integers — sats and cents as `bigint`, with a price snapshot

**Date:** 2026-10-07 · **Status:** accepted · Implemented in `packages/core/src/money.ts`

## Decision
- Bitcoin amounts are **sats** as `bigint`. Never BTC, never floats, never `number` for amounts.
- Fiat amounts are **US cents** as `bigint`. (A currency code can be added without changing callers.)
- Constructors `sats()` / `cents()` reject negatives and non-integers with a typed `MoneyError`.
- Every decision takes a `PriceSnapshot` (cents per BTC, when, from where). Summaries and ledger
  rows are reproducible forever without a live feed.
- Rounding is explicit and directional: sats→cents rounds **down** (reporting never overstates),
  cents→sats rounds **down** (we never promise more than was bought).
- Adapters convert at their boundary (NWC speaks msats; Strike speaks decimal strings) and expose
  only sats/cents to the core.
- CI runs `scripts/no-float-money.mjs`: a float smell next to a money identifier fails lint.

## Why
Off-by-one-sat bugs from floats are indistinguishable from theft to a user reading their ledger.
`bigint` makes the type system refuse `0.1 + 0.2`. Sats (not msats) because every rail we target
accepts whole sats and the agent's budgets are human-sized.

## Consequences
- `bigint` is not JSON-serialisable; `serializeAction` encodes as `"123n"` strings and the MCP/API
  layers do the same.
- Sub-sat fees from a wallet are rounded up to the sat by the adapter.
