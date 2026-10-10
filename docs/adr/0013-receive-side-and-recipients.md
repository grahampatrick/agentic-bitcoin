# ADR-0013 — The receive side: recipients, `give`, and verification

**Date:** 2026-10-10 · **Status:** accepted · M9

## Context

Phase 1 paired the *payer's* wallet. Giving to a church, supporting a missionary or tipping a
creator needs the other side: who may receive, under what name, and how we know the Lightning
address really belongs to them. A lookalike recipient is the obvious attack ("redeemer" vs
"redeemer-nyc"); a stale address is the obvious failure.

## Decision

1. **A recipient is a name and a Lightning address, never a balance.** Directory entries have no
   owner and are visible to everyone once verified. A user may add *private* recipients that only
   they can see or give to. Nothing we store can move money.
2. **The `give` Action carries the resolved recipient** (slug, display name, Lightning address,
   trust flag) rather than a bare slug. The policy judges the real destination without any lookup,
   and the confirmation hash binds exactly the name and address the human saw. `schedule_give`
   does the same; the runner re-resolves the slug at every firing and pauses the schedule if the
   recipient is gone, or lets the policy deny it if trust was revoked.
3. **Verification is two cheap facts from the recipient's own infrastructure:** the address
   answers LNURL-pay, and (for "domain" verification) the recipient's website is on the address's
   domain. Otherwise the operator vouches ("operator"). Unverified directory entries cannot
   receive gifts — the policy denies with `RECIPIENT_UNVERIFIED` before any cap is considered.
4. **Slugs are operator-assigned**, stable, lower-case `[a-z0-9-]`; the agent must take them from
   `find_recipient` results. Private slugs are derived from the user's own name for the entry.
5. **Recipient-supplied text is untrusted.** Names, descriptions and websites are wrapped as data
   before the model sees them; the eval suite includes a recipient whose description tries to
   steer the model.
6. **Purposes** (`tithe`, `offering`, `support`, `tip`, `gift`) and the USD value at request time
   are stored on the action so a giving statement can be produced from the ledger alone. We are
   not the donee and issue no receipts.

## Consequences

- Giving reuses the wallet rail and the scheduler; there is no second payment path.
- The directory is small and curated by design. Growth comes from private recipients and, in
  M10, from recipients onboarding themselves with receive-only wallet connections.
- Open: who vets a church (OQ-12), the domain for our own Lightning addresses (OQ-13), tax
  language (OQ-14).
