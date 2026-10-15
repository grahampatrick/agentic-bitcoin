# ADR-0018 — Invoices are minted by the issuer's wallet; our pay link is a pointer

**Date:** 2026-10-14 · **Status:** accepted · M14

## Context

The business line is non-custodial invoicing: organisations and merchants bill people and get paid over
Lightning, from chat first. The obvious implementation — we hold a balance and settle up — is custody.

## Decision

1. **The issuer's wallet mints every BOLT11.** A chat user issues from their paired wallet at creation
   time (seven-day expiry, stored on the invoice). A web-onboarded recipient's invoice is minted lazily
   when the pay link is first opened, on their receive-only connection or via their Lightning address
   (M10 sources), and re-minted after expiry. One live BOLT11 per invoice; its hash is the identity.
2. **Our pay link is a pointer.** `/pay/<token>` shows the bill and the issuer's invoice. The token is
   unguessable and carries no money. Paid is terminal; void is only possible while open; overdue and
   expired are derived, never stored.
3. **Settlement is observed, never asserted by us.** The bot checks the issuer's own wallet for open
   invoices each minute and tells the issuer when one settles; a recipient's connected wallet does the
   same for the web; otherwise the payer proves payment with the preimage (sha256 → payment hash), as in
   the store. The issuer may mark an invoice paid outside Lightning, flagged as reported.
4. **Issuing is an action that moves no sats**, recorded in the issuer's ledger through the executor
   like everything else; recurring invoices are schedules that issue a fresh one per firing.
5. **The payer's contact is sealed**; their name is on the invoice by nature. Both are data to the agent.
6. **Our own pay links are payable from chat**: `pay this <link>` resolves to the issuer's BOLT11 and
   then takes the normal policy path, destination `invoice:<issuer>` for allow/deny lists.

## Consequences

- No fiat, point of sale or tickets; those wait for a paying customer (plan M14).
- Reminders are text the issuer forwards; we never message a payer.
- Pricing for organisations is open (OQ-18); nothing here depends on it.
