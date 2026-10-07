# ADR-0006: Nostr Wallet Connect is the wallet socket; secrets are AES-GCM at rest

**Date:** 2026-10-07 · **Status:** accepted · Implemented in `packages/rails/src/wallet/nwc.ts`, `packages/rails/src/secrets`

## Decision
- The one `WalletRail` in production is **NWC (NIP-47)** via `@getalby/sdk`. The user's own wallet
  (Alby Hub, Coinos, LNbits, Primal, Zeus, …) issues a connection string with a **budget and expiry**;
  the wallet enforces that budget independently of our policy engine — two fences.
- Every merchant/compute rail returns a BOLT11; only this adapter pays it (non-negotiable #6).
- Before paying, the adapter **decodes the invoice** and refuses one whose amount differs from the
  approved amount. It looks the payment hash up first and returns the stored preimage if this wallet
  already settled it (crash recovery). A timeout after `pay_invoice` polls `lookup_invoice`, then
  surfaces `UNKNOWN_STATE`, which the executor keeps **pending** rather than failed.
- Lightning addresses resolve with `@getalby/lightning-tools` directly against the domain (`proxy:
  false`), and the returned invoice must decode to the requested amount.
- Secrets at rest use **AES-256-GCM from `node:crypto`** (the plan said libsodium; the built-in is
  authenticated, audited, and adds no dependency). Key from `SECRETS_KEY`, 32 bytes. Blob format
  `v1.iv.tag.ct`. Connection strings are never logged; error messages pass through `redact()`.
- **Breez SDK stays a stub.** An embedded wallet means holding a seed, which crosses the custody line
  unless the seed lives on the user's device. Revisit only with that design.

## Why
NWC is the only wallet interface that is wallet-agnostic, budgeted at the source, revocable by the
user, and already shipped by dozens of wallets. Decoding before paying closes the gap between "what
policy approved" and "what the invoice asks for".

## Consequences
- Users must run or choose an NWC-capable wallet; onboarding (M7) must insist on a budgeted string.
- `pay_keysend`, hold invoices and notifications are available in the SDK if later milestones need them.
