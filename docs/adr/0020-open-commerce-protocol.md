# ADR-0020 — An open commerce protocol: four endpoints, the merchant's invoice, the preimage as receipt

**Date:** 2026-10-21 · **Status:** accepted · M16

## Context

Card-based agent commerce has protocols (OpenAI/Stripe ACP, Google AP2); Lightning has none. Every
Lightning merchant today has a human checkout and nothing an agent can call. Anvard needs inventory from
shops it does not run, starting with card shops.

## Decision

1. **Four pieces** (docs/protocol/anvard-commerce.md): a manifest at `/.well-known/anvard.json`, a
   product feed, a checkout that returns the merchant's own BOLT11 for the whole order, and an order
   status. Nothing else is required. Signing with a Nostr key is optional in v0.
2. **Anvard both serves and consumes it.** Every verified directory merchant is exposed through the same
   four endpoints (reference implementation), and any remote shop that serves them becomes a
   `RemoteMerchantRail` behind the one goods socket, searchable from chat and the store, buyable by any
   MCP client.
3. **Remote feeds are mirrored into the catalogue** on connect and every 30 minutes, so browsing never
   depends on a shop being up; checkout and status always go to the shop.
4. **Shipping to remote shops travels in plain text over HTTPS to the shop and nowhere else.** The
   directory stores only the sealed copy for the buyer's order page. Chat purchases of physical goods from
   remote shops are refused until the bot can forward shipping the same way (M16.1).
5. **Importers meet shops where they are:** CSV exports (TCGplayer, BinderPOS, Crystal Commerce, any
   sheet), Shopify's public products.json, with trading-card fields detected from columns.
6. **Trading cards are first-class:** `game, set, number, condition, grade, finish, language,
   provenanceUrl` on products, searchable, filterable, and the provenance link rendered as a badge.

## Consequences

- A BTCPay plugin and a Shopify app are the two integrations that would bring the most shops; both are
  thin over this spec.
- Discord joins Signal as a surface for the players, DMs only; one dispatcher serves both.
