# ADR-0016 — The storefront is an aggregator: merchant invoices, sealed shipping, preimage as proof

**Date:** 2026-10-10 · **Status:** accepted · M12

## Context

The product asks for a store in the shape of the Shop app — one search, categories, a featured
merchant, deals, a cart — where everything runs on Lightning, reachable from Signal, and buyable by
text once you know what you want. Doing that without becoming a custodian or a merchant of record
constrains every part of the design.

## Decision

1. **Merchants are recipients** (M10) of kind `merchant`. Their products live in our catalogue; their
   money never does. **Every order is one invoice minted by the merchant's own wallet** — via their
   existing Lightning address (LNURL-pay proxy, amount verified by decoding) or their sealed
   receive-only wallet connection. A cart with several merchants becomes several invoices, never a
   pooled one. Unverified merchants are neither listed nor sellable.
2. **One goods socket, many suppliers.** The storefront is a `GoodsRail` (`DirectoryGoodsRail`), so
   chat purchases take the same executor path as Bitrefill: policy, confirmation, pay, ledger. A
   `CompositeGoodsRail` routes by product id (`dir:` → directory, else Bitrefill) and merges search.
3. **Shipping is sealed before it becomes an Action.** The agent's tool input is encrypted with
   `SECRETS_KEY` inside `toolToAction`; the ledger, logs and model history only ever hold the blob.
   The web checkout seals the same way on the server. Only the merchant's dashboard decrypts it.
   Without `SECRETS_KEY` the server refuses to accept an address at all.
4. **Paid is terminal for shipped goods.** The executor records its own payment (`markPaid` with the
   preimage) and stops polling; the merchant fulfils later from their dashboard and the order page
   tracks it. Digital goods keep ADR-0011's poll-to-delivered semantics, with the merchant's note
   (a link) as the "redemption".
5. **Proof of payment is the preimage.** Where the merchant's wallet is connected we observe
   settlement ourselves; otherwise the buyer pastes the preimage their wallet shows, and we accept it
   only if its sha256 equals the invoice's payment hash. No trust, no screenshots.
6. **The cart is the browser's.** `localStorage` holds the cart and the buyer's order ids; the server
   learns of a cart at checkout and nothing before.
7. **Structure, not identity.** We copy the Shop app's layout and interactions (left rail, search pill,
   chips, hero with tiles, deals row, cards), never its name, logo, copy or merchants. The demo
   catalogue is fictional and says so.

## Consequences

- Refunds are between merchant and buyer (Lightning has no chargebacks); the order page carries the
  payment hash and the merchant's contact, and the merchant can pay back to the buyer's address.
- Prices are in cents and converted to sats at checkout; invoices expire in ten minutes, so a stale
  price never persists.
- Growth is merchant onboarding (`/receive`, kind merchant), the same path churches use, plus the
  operator's `/verify`.
