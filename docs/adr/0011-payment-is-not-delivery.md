# ADR-0011: Payment is not delivery; codes are bearer secrets

**Date:** 2026-10-07 · **Status:** accepted · Implemented in `packages/core/src/executor.ts`, `packages/rails/src/goods/bitrefill.ts`

## Decision
- A merchant purchase is a four-state machine: **unpaid → paid → delivered | failed**. The
  executor pays the merchant's BOLT11 through the wallet rail, then **polls the merchant** (bounded:
  default 30 polls × 2 s) until `delivered` or `failed`. Only `delivered` means the user has the
  goods; `paid` is reported as such, never as success (Bitrefill's own guidance).
- `buy_product` **always** needs a human yes (policy engine, since M1), and the confirmation
  summary names the merchant, the product and the price in sats and fiat.
- The sats amount of a merchant invoice comes from **decoding the BOLT11**, never from a fiat field
  the merchant reports; the executor refuses an invoice above the approved ceiling before paying.
- **Redemption data is a bearer secret.** It is returned once to the caller (the chat surface sends
  it to the human as a separate message), it is replaced by a placeholder in what the model sees,
  it is never written to chat history, and it reaches the ledger only through `seal()` (AES-GCM
  with `SECRETS_KEY`). Without a sealer nothing is stored. Logs never contain it.
- A product search is a read Action (`search_products`) on the goods rail: no spend, no
  confirmation, but subject to the kill switch and the rail flag, and ledgered like every action.
- Bitrefill specifics: Personal API Bearer key; `POST /invoices` with `payment_method: "lightning"`;
  the invoice carries payment + delivery state, the order carries `redemption_info`. The reference
  does not spell out the lightning field or the status enum, so the adapter accepts
  `payment.lightning_invoice` or an `ln…` `payment.address`, treats `complete`/`delivered`/
  `delivered_time` as delivered and `expired`/`cancelled`/`failed` as failed. Test products are
  Business-tier only, so `demo:goods` buys a real cheap item. The live run verifies the assumptions.

## Why
Merchants confirm payment seconds before they fulfil; reporting "done" at payment produces
support tickets and, worse, a model that believes the user has a code they do not. Codes are
cash: the rule set for seeds and connection strings applies to them.

## Consequences
- The template for Fold, Oshi, domain registrars and Nostr marketplaces is this file: implement
  `GoodsRail`, map states, leave payment and polling to the executor.
- Delivery timeouts surface as `paid` with the order id; the user can ask again later and the
  merchant's order endpoint still returns the code.
