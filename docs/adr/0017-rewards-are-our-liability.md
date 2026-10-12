# ADR-0017 — Sats-back rewards are our liability, paid through the same executor

**Date:** 2026-10-11 · **Status:** accepted · M13

## Context

Shop-style marketplaces keep users with cashback. We want sats-back on purchases without creating a
balance users hold with us (custody by another name) and without a second payment path.

## Decision

1. **A reward is a promise we make**, recorded when an order is paid: source, order, purchase size, the
   rate in basis points, the amount, and the date it becomes payable (one day for digital goods, 14 for
   physical, the returns window). One reward per order, at most 100,000 sats. Until paid it is listed as
   pending or payable — never as a balance.
2. **Payouts are ordinary spends from the operator's own wallet**, made by the minute runner through
   `execute` with the operator's policy (daily cap, kill switch) and the operator's ledger, pre-approved,
   with an idempotency key built from the reward ids so a batch is never paid twice.
3. **The payee controls the destination.** Chat buyers are paid to an invoice minted on their own paired
   wallet; web buyers to the Lightning address they typed at checkout. Nobody asks for a payout and
   nobody registers a wallet with us for it.
4. **Rates are operator configuration** per source. Bitrefill stays at zero until its affiliate terms
   are confirmed to allow bitcoin payouts (OQ-16). Rewards can be withdrawn for future purchases;
   recorded rewards are honoured.
5. When the operator wallet cannot pay (cap, outage), rewards flip to `payable` so the user sees what is
   owed, and the next run pays them.

## Consequences

- No new rail and no new money path; the operator's ledger is the audit trail for every payout.
- The operator funds rewards from revenue (merchant commissions are M14+ material); the daily cap bounds
  the exposure.
