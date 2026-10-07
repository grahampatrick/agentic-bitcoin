# ADR-0005: Policy before rail — one executor, one gate, an append-only ledger

**Date:** 2026-10-07 · **Status:** accepted · Implemented in `packages/core/src/{policy,executor,ledger}.ts`

## Decision
- Every bitcoin action is a typed `Action` (`action.ts`). The LLM, the scheduler and chat all emit
  Actions; none of them hold a rail.
- `evaluate(action, policy, window, ctx)` is pure and is the **only** gate. Checks run in a fixed,
  tested order: kill switch → rail enabled → deny list → allow list → per-action cap → daily cap →
  merchant always-confirm → confirm threshold.
- `execute()` is the only function that may call a rail's spending method. It replays idempotent
  keys, evaluates, appends `requested` + `started` to the ledger *before* the rail call, then
  appends `succeeded`/`failed`. A crash mid-payment is visible as `pending` and counts against the
  budget until resolved.
- The daily cap is computed from the **ledger window** (rolling 24h, succeeded + pending), never
  from a counter, so restarts cannot reset it.
- `needs_confirmation` carries `actionHash` (sha256 of the canonical action). A confirmation is
  valid only if its hash equals the hash of the action being executed, so nothing can confirm one
  thing and run another.
- The ledger is **event-sourced and append-only**; `LedgerEntry` is a fold. Stores implement
  `append` and `events` only.

## Why
A model that can call `pay()` directly is one prompt injection from draining a wallet. A gate in
code with fixed order and ≥40 tests is reviewable; a prompt is not. Confirmation binding closes
the "confirm 21 sats, execute 21,000" hole.

## Consequences
- New rails are adapters plus fixtures; they inherit safety for free.
- Policy changes are data, not code paths; the UI (M7) edits a `Policy` object.
- Reads (`get_balance`, `make_invoice`) bypass caps and lists but not the kill switch or rail flags.
