# ADR-0023 — A bill is a schedule; an "ask" bill parks where every confirmation parks

**Date:** 2026-10-27 · **Status:** accepted · M20

## Context

Cash App's roadmap lists "pay bills with bitcoin". For them it is a bill-pay network behind a
custodial balance. For Anvard a bill is simpler and older: a recurring payment the user already
owes, to a payee who takes Lightning (a landlord, a carrier, a subscription that posts a Lightning
address), from the user's own wallet. We already have the machinery: schedules are data (ADR-0010),
every firing is an ordinary Action through policy and the ledger, and confirmations park in one
pending store that a plain "yes" releases.

## Decision

1. **`schedule_bill` is an Action** like `schedule_give`: name, Lightning address, dollars (re-priced
   at pay time) or fixed sats, cron, `mode`. Creating one always needs the user's yes.
2. **A bill is a schedule of kind `bill`** with `{name, mode, memo}`. Each firing becomes
   `pay_address` with `requestedBy: "schedule"`, the bill's name as memo, keyed to the slot so a
   month is paid at most once.
3. **`mode: "auto"`** pays on the day, pre-approved by the schedule the user confirmed, within their
   limits (a denial lands in the ledger and chat like any schedule).
4. **`mode: "ask"`** never executes in the runner. The runner hands the built `pay_address` to an
   `ask` hook; the bot puts it in the user's pending store and sends "… is due. Reply yes". The
   same `decide` path that handles every other confirmation pays it. Nothing is ledgered until the
   yes, so a skipped month leaves no trace but the schedule's `lastRunAt`.
5. **The payee is a Lightning address the user typed.** The model may not infer one; a bill to a
   church or missionary by name is giving (verified recipients), not a bill. Allow/deny lists apply
   to the address like any payment.

## Consequences

- `/bills` lists bills with their next date from the cron; `/bills cancel <id>` stops one.
  `list_schedules` and `cancel_schedule` cover the same from the model.
- Dollar bills move with the price: $450 is whatever sats $450 is at 14:00 UTC that day. The
  per-action cap still applies, so a cap below the bill denies it rather than paying part of it.
- No bill-pay network, no fiat payee: a payee who does not take Lightning is out of scope until a
  Bitrefill-style bill product exists, which would be a goods purchase, not this.
- Migration `0013_bills.sql` adds `bill` to the schedule kinds and a `bill_json` column.
