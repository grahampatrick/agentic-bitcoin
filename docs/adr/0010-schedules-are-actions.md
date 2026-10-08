# ADR-0010: Schedules are data; every firing is an Action

**Date:** 2026-10-07 · **Status:** accepted · Implemented in `packages/scheduler`, `packages/rails/src/exchange/strike.ts`

## Decision
- A schedule is a row: `exchange`, `usdCents`, five-field UTC `cron`, `sweepToWallet`, `active`,
  `lastRunAt`. Nothing else. No code path buys bitcoin except core `execute`.
- The runner wakes once a minute, finds schedules whose cron matches the current UTC minute and
  whose `lastRunAt` is not that minute, **claims the slot first** (`markRun`) and then executes a
  `buy_bitcoin` Action with `requestedBy: "schedule"` and idempotency key `<scheduleId>:<slot>`.
  Caps, allow-lists, the kill switch and the ledger apply unchanged; a denied or failed run is in
  the ledger like any other action and is not retried until the next slot.
- `schedule_buy` and `cancel_schedule` Actions reach the store through the executor's
  `schedules` hook (`schedulesHook`), so creating or cancelling a schedule is also policy-checked
  and ledgered.
- Quote → execute is one tight call inside the Strike adapter (quotes live ~15 s); no model and
  no human sits between them. The approved amount is the USD figure; the sats estimate is for
  budgets and is refreshed from the live price at each firing.
- The runner is a plain function (`runDue`). It runs from `pnpm --filter @agentic-bitcoin/scheduler worker`
  (a loop) today; a Vercel cron route can call the same function later (OQ-4). Two runners are
  safe because the slot is claimed before the buy.
- Optional **sweep**: after a successful buy, make an invoice on the user's wallet and have Strike
  pay it, so bought sats leave the exchange. Off by default; it needs the Lightning payment-quote
  scopes on the key, and a key with those scopes must never be stored unless the user turned the
  sweep on (plan pitfall). Never grant withdraw scopes otherwise.
- Coinbase stays an interface-only stub; Strike is the reference implementation.

## Why
One payment path, one audit surface. A scheduler that buys "directly" would be a second place to
get budgets wrong. Slot claiming before execution is the simplest way to make retries and
duplicate workers safe without locks.

## Consequences
- Sub-minute cadence is not supported, by design.
- `/ledger` shows scheduled buys next to manual ones with `requestedBy: schedule`.
- Strike's ticker and error-envelope shapes come from secondary sources (its reference pages 404
  without auth); the adapter parses them tolerantly and `demo:dca` verifies them live.
