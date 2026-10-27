# ADR-0019 — Signal and Discord plus the browser; no native app; never a custodial wallet

**Date:** 2026-10-21 · **Status:** accepted · Phase 3 / M15

## Context

The product has grown a store, giving pages, invoices and campaigns. The question was whether to
build a native app, keep everything in chat, or both, and whether to ship "a small wallet" so Lightning
is easy for newcomers.

## Decision

1. **The chat thread is the app; the browser is for everything that needs a screen or a stranger.**
   Signal (and Discord for the TCG community) carries every action a user takes; the web carries the
   store, pay links, give pages and dashboards, usable by anyone without an account. No native app: it
   would be a third surface to keep alive, App Store review treats bitcoin apps with suspicion, and it
   buys nothing a thread plus a page does not. Revisit only if chat becomes a ceiling.
2. **We do not run a wallet for people.** A wallet we hold is custody by another name and reopens every
   legal question. "Lightning made easy" is an onboarding problem: one-tap pairing into the user's own
   Alby Hub or Coinos with a budget pre-filled (`/connect`), and a no-wallet path that creates a Coinos
   account that is theirs.
3. **Paying is one tap.** `lightning:` links first, the browser wallet (WebLN) when present, named wallet
   buttons behind "More wallets", copy last. When a browser wallet pays, the preimage it returns is posted
   back as proof, so settlement does not depend on the merchant's wallet being connected.
4. **Lightning addresses are pointers.** `name@anvard.ai` makes the user's own wallet mint each invoice (or
   forwards to an address they already have); the bot notices settlement on that wallet and says so.
5. **The card is virtual**, non-custodial: a policy on the user's wallet, not a balance (ADR-0021).
   No physical card (decided 2026-10-27).

## Consequences

- Deep-link formats per wallet are unverified until tested on a phone (docs/wallets.md, OQ-19).
- Addresses need the web and the bot on one database, and the user's wallet reachable at pay time.
