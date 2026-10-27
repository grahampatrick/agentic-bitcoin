# ADR-0022 — Replacing the bitcoin you spend is derived from the ledger, not kept as a counter

**Date:** 2026-10-27 · **Status:** accepted · M19

## Context

Cash App's roadmap has "automatically replace the bitcoin you spend": pay with bitcoin, and the app
buys the same dollar value back so the stack does not shrink. Cash App can do it in one ledger
because it holds both the bitcoin and the dollars. We hold neither: the user's sats are in their
own Lightning wallet and their dollars are on their own Strike account. The feature still fits,
because it is a *rule*, and rules are what Anvard is.

## Decision

1. **A replacement is an ordinary `buy_bitcoin` Action** with `requestedBy: "schedule"` and the
   idempotency key `replace:<ledger entry id of the spend>`. It goes through `execute` like every
   other buy: the user's policy (rails, daily cap, kill switch), the ledger and the exchange rail
   apply unchanged. There is no second payment path.
2. **Which buys are due is computed from the ledger** (`replacementsDue`, pure): succeeded spends
   that left the wallet (`pay_invoice`, `pay_address`, `buy_product`, `pay_l402`, `give`) since the
   rule was turned on, that have no entry keyed `replace:<id>` yet. No counter, no queue, nothing
   to drift. One spend, one attempt: a denied or failed replacement is final for that spend, so a
   broken exchange never retries every minute.
3. **The rule lives on the policy** (`Policy.replaceSpend`): enabled, percent, exchange, minimum
   per spend (exchange minimums), rolling daily cap in dollars, sweep-to-wallet, and `since`. It is
   set with `/replace`, outside the model's reach, like every other limit (prompt rule 5).
4. **It runs where spends happen**: after a chat turn or a confirmation (`afterSpend`), and after a
   scheduled gift fires. Every spend passes one of those doors, so no loop over users is needed.
5. **Sweep by default.** The sats left the Lightning wallet, so the bought sats go back into it
   through the same `makeSweep` the DCA path uses (the exchange pays an invoice the wallet minted).
   `/replace wallet off` leaves them on the exchange.

## Consequences

- A replacement counts against the user's daily sats cap like any buy (it is budgeted at its
  estimate). A user near the cap sees "Replace skipped … RAIL_DISABLED / DAILY_CAP" once, in the
  ledger and in chat, and keeps their cap.
- Replacement buys never replace replacements, DCA buys or sweeps: only money that left the wallet.
- Needs a Strike key (`/key strike`). Turning the rule on also turns the exchange rail on, because
  that is what the person asked for; the message says so.
- Dollar amounts are computed at the price at run time, rounded down in cents; the exchange's own
  minimum is enforced by `minUsdCents` ($1 by default).
