# ADR-0028 — The first charge is a shop plan, paid as an ordinary invoice

**Date:** 2026-10-29 · **Status:** accepted · M24

## Context

Anvard has had no revenue line. OQ-27 listed four: a merchant subscription, hosted-assistant billing,
affiliate margin, a per-order protocol fee; OQ-18 had already proposed $21 a month per organisation,
paid over Lightning to the operator. We rule out any spread on payments or on the buy/DCA path
(custody, an exchange licence). The storefront, protocol endpoints, importers and listing are the
thing a card shop would plausibly pay for, and the one that costs the operator real work.

## Decision

1. **A flat monthly shop plan**, priced in dollars (`PLAN_SHOP_USD_CENTS`, default $21), paid in
   sats at the day's price, after a free pilot (`PLAN_PILOT_DAYS`, 60) and with a grace period
   (`PLAN_GRACE_DAYS`, 14). Individuals, churches, missionaries, tips, pay links, invoices and
   campaigns stay free: the plan is for selling.
2. **The operator is a recipient like any other** (`PLAN_PAYEE_SLUG`), onboarded at `/receive` with a
   receive-only NWC string. A plan invoice is an ordinary M14 invoice issued by that recipient to the
   merchant: minted on the operator's wallet, paid at `/pay/<token>`, settled there by
   `lookupInvoice` or the payer's preimage. No second payment path, no card on file, no custody.
3. **The plan row holds only dates**: `pilot_ends_at`, `paid_through_at`, the open invoice id, and the
   ids already applied, so a paid invoice never extends the plan twice. A payment adds one calendar
   month from the later of the paid-through date and the payment day: paying early during the pilot
   starts the month when the pilot ends; paying late starts it on the day.
4. **States and what they stop.** `free` (plans off) · `pilot` · `active` · `due` (past the date,
   inside grace, everything still on) · `lapsed`: the merchant's products leave `/shop` and the
   directory and checkout refuses. Their own pay links, tips, invoices and campaigns keep working, and
   paid orders stay theirs to fulfil. We never hold a sale hostage; paying any time turns it back on.
5. **The gate is one function**, `merchantMaySell`, injected into the shop service (`maySell`);
   tests and the keyless demo run without it.

## Consequences

- Migration `0017_plans.sql`; `SupabasePlanStore` in `@agentic-bitcoin/stores`.
- The merchant portal gets a Plan page and a real Subscription panel; "Pay now" asks
  `POST /api/receive/<slug>/plan` for the open invoice's link.
- Plans are off until the operator sets both a price and a payee, so a fresh deploy charges nothing.
- Not done: reminders before the date, annual plans, grandfathering by rule (set `paid_through_at` by
  hand), the per-order protocol fee (only once plans show people pay).
