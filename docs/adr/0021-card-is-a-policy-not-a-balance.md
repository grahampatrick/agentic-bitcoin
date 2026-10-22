# ADR-0021 — A card is a policy, not a balance

**Date:** 2026-10-22 · **Status:** accepted · M17a (virtual), extended by M17 (physical)

## Context

Neobanks let a user say "create a virtual card for Netflix with a $15 limit" and get a card they can
see, pause and spend from. On Lightning the equivalent does not exist, and the custodial way to build
it (a sub-balance we hold) is exactly what Anvard refuses to do.

## Decision

1. **A virtual card is a scoped budget on the user's own wallet.** `VirtualCard` = name + scope +
   monthly cap (+ optional per-action cap and confirm threshold) + reset day + state. No sats ever
   move into it; closing one changes nothing about the wallet.
2. **The executor attaches a card to a spend by scope**, tags the ledger entry with `cardId`, and
   evaluates the card's caps on top of the user's policy. A card can only narrow: the user's daily and
   per-action caps still apply first. `CARD_PAUSED`, `CARD_PER_ACTION_CAP`, `CARD_MONTHLY_CAP` are
   distinct deny reasons so the chat can name the card and what is left.
3. **The ledger is the source of truth for spend**; the card row keeps a display snapshot so the web
   page and `/cards` need no ledger scan.
4. **Creating a card, resuming it or raising its limit needs a human yes**; pausing or closing is
   instant. The model still cannot touch the user's policy (prompt rule 5).
5. **Scope grammar** is small and literal: `product:<text>`, `merchant:bitrefill`, `shop:<slug>`,
   a Lightning address or `*@domain`, a host, `rail:<name>`, `kind:<action>`, `*`.
6. **The card page** (`/card/<id>?t=<token>`) shows the budget and a pause button to whoever holds
   the token the assistant returned once; without it, only the name.

## Consequences

- The physical Anvard Card (M17) is a virtual card with an NFC credential: every tap becomes an Action
  that lands on the card by scope, so M17 adds a transport, not a new money model.
- Cards do not carry their own Lightning address yet (one address per user today); a `<card>.<name>@`
  handle is a later addition once addresses allow several per user.
- Merchants that only take fiat cards (Netflix) are reached through Bitrefill gift cards; a card scoped
  `product:netflix, merchant:bitrefill` does that honestly.
