# ADR-0027 — The web is a window; chat is the key

**Date:** 2026-10-29 · **Status:** accepted · M23

## Context

Instinct's account screens (Workspace with invites and contact, Vault, Trusted people,
Preferences, Invite a friend, Connectors) make it easy to see what the assistant may do and to
change it without learning commands. We want the same ease. We do not want passwords, SMS codes,
OAuth or a second identity: the chat a person texts from already is their identity (ADR-0019), and
every store is keyed by that chat id.

## Decision

1. **No sign-in on the web.** `/web` in chat mints a 24-byte random token and replies with
   `<site>/me?t=<token>`. The store keeps the token's SHA-256 and a 30-day expiry
   (`WEB_LINK_TTL_DAYS`), never the token. The page checks the hash on every request. `/web revoke`,
   "Log out" and "Log out everywhere" delete the rows. The same shape as card and merchant links.
2. **The workspace is a view over existing stores.** Policy, sealed secrets, Lightning address,
   cards, referrals and rewards are the bot's rows, read by the web through the shared Supabase
   stores. Policy and secret stores moved from the bot into core and `@agentic-bitcoin/stores` so
   there is one implementation.
3. **Secrets never cross to the web.** The workspace asks only whether a blob exists. SECRETS_KEY
   is not in the web's environment and the web never decrypts anything.
4. **Writes are the same changes chat makes.** `patchPolicy` in core is the one way a form changes
   limits, rails, the kill switch and the allow/deny lists; the bot and the web enforce identical
   rules (caps are whole sats, per-action never above daily, destinations are addresses or
   patterns). Cards can be paused and resumed. Pairing, keys, cold storage and replace-what-you-spend
   are read-only on the web and point back to chat, because those involve secrets or amounts the
   confirmation flow should own.
5. **A keyless demo.** Without a database, `/me?t=demo` opens a fictional account so the shape is
   visible on a fresh deploy, like `/card/card_demo` and the demo merchant portal.

## Consequences

- Anyone holding a live link sees what the user sees and can change limits; the page says so and
  links expire. Revocation is one message away.
- Migration `0016_web_links.sql`. The bot's file store keeps links under the `shop` bucket.
- The Instinct nouns map as: Workspace → invites, at a glance, contact · Vault → wallet, address,
  cards, cold storage, keys · Trusted people → allow and deny lists, friends you invited, kill
  state · Preferences → identity, links, limits, rails, kill switch · Connectors → the rails and
  keys as a checklist · Invite a friend → the referral page.
- Not done: a display name, a web-side `/pair`, editing replace-what-you-spend, and a ledger view.
