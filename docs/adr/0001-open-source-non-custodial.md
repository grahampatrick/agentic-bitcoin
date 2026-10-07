# ADR-0001: Open source, MIT, and non-custodial from the first commit

**Date:** 2026-10-07 · **Status:** accepted

## Context
An assistant that can spend bitcoin on a person's behalf is only trustworthy if (a) anyone can read
exactly what it does and (b) it structurally cannot run off with the money.

## Decision
- The repository is public under the MIT licence from the first commit. No private "core".
- We never custody: no seed phrases, no private keys, no pooled balances. The agent spends through a
  scoped Nostr Wallet Connect string the user's own wallet issues with a budget and expiry; exchange
  purchases run on the user's own API key.
- Secrets never enter git: `.env*` is ignored, gitleaks runs in CI, every rail has a fake backend so
  the whole test suite runs with no account anywhere.
- No financial advice, in the product or the copy. The agent executes instructions.

## Consequences
- Contributors can run everything locally with zero credentials.
- Features that would require custody (pooled liquidity, instant fiat off-ramp we hold) are out of
  scope, permanently.
- Terms and Privacy pages state the non-custodial, no-advice position in plain words.
