# ADR-0014 — LNURL-pay served by us, invoices minted by the recipient

**Date:** 2026-10-10 · **Status:** accepted · M10

## Context

Recipients (churches, missionaries, creators) need a way to be paid by anyone — our users from
chat, strangers from a web page, a tip button on their own site — without us holding money and
without them running infrastructure. LNURL-pay and Lightning addresses are the interoperable way
to do that; the question is who produces the invoice.

## Decision

1. **We serve LNURL-pay; the recipient's wallet produces every invoice.** `/.well-known/lnurlp/<slug>`
   and its callback are ours, so each recipient gets `slug@<our host>` and hosted `/give/<slug>`
   and `/tip/<slug>` pages. The invoice we hand back is always one the recipient's wallet created:
   - **proxy** — the recipient already has a Lightning address: we relay to its LNURL-pay endpoint and
     return its invoice unchanged, after decoding it to check the amount matches.
   - **nwc** — the recipient pairs a **receive-only** Nostr Wallet Connect string (`make_invoice`,
     `lookup_invoice`; anything that can spend is refused at onboarding). We call `make_invoice` in
     their wallet. The string is sealed with `SECRETS_KEY`; only the web receive service decrypts it.
   The payee is therefore always the recipient. We never see a preimage before they do.
2. **We store hashes, not money.** `receive_invoices` keeps payment hash, amount, comment and source so
   a recipient can see what arrived (settlement via `lookup_invoice` where available). Nothing in our
   database can be spent.
3. **Self-onboarding is pending by default.** A recipient who submits the form gets pages and an
   address immediately but is *unlisted and cannot receive from our users* until the operator runs
   `/verify <slug>` (or the address is on their own domain — ADR-0013). Strangers paying the hosted
   page directly are between them and the recipient; our policy engine only governs our users.
4. **Minting is rate-limited per slug** (invoices per minute) and comments are bounded and stripped of
   control characters: a public endpoint that creates invoices in someone else's wallet is a nuisance
   surface, so it is capped.
5. **Dashboard access is a bearer token** shown once at onboarding and stored hashed. No accounts,
   no email. Losing it means re-onboarding (the operator can re-issue).

## Consequences

- Lightning addresses work today on the vercel.app host; a real domain (OQ-13) only changes the
  suffix.
- A recipient on a custodial wallet (Wallet of Satoshi, Strike) can onboard with the proxy source in
  one minute; self-custodial recipients (Alby Hub, Coinos, Zeus) get the NWC source.
- Receipts and tax status remain the recipient's (OQ-14).
