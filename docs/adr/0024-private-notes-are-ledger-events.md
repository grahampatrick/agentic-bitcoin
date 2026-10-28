# ADR-0024 — A private note is a sealed ledger event, never part of the action

**Date:** 2026-10-27 · **Status:** accepted · M21

## Context

Cash App's roadmap lists "private transaction notes": a note on a bitcoin payment that only the
sender sees, as opposed to the payment note the counterparty reads. Anvard already has the public
half: a `memo` on a Lightning address payment and a `note` on a gift both travel to the payee in the
invoice description. What was missing is the half that stays home: "plumber deposit", "reimbursed by
work", "rent share", written for the user's own records.

Three places could hold it. In the action, where it would be hashed, stored in plain in the
`requested` event, and visible to every rail and hook that reads actions. In a side table keyed by
entry id, a second source of truth the ledger fold would not see. Or in the ledger itself, as one
more event type on the entry it belongs to.

## Decision

1. **A note is a ledger event.** `{ type: "noted", id, at, note? | sealed? }` appends to the payment's
   entry; `foldEntries` puts the latest one on `LedgerEntry.note` / `noteSealed`; an event with
   neither clears it. The ledger stays append-only and the audit replays notes like outcomes.
2. **Sealed when the server can seal.** With `SECRETS_KEY` the text is stored encrypted (the same
   AES-256-GCM used for wallet strings and shipping details) and opened only for the user who owns the
   ledger. Without a key it is stored in plain, like the memo already is; nothing is silently dropped.
3. **The action never carries it to a rail.** `privateNote` may ride on any action so a confirmation
   hash covers what the human saw, but the executor strips it before the `requested` event and never
   passes it to a wallet, exchange or merchant. A memo is what the payee sees; a note is not.
4. **Adding a note later is an action too.** `add_note` targets a payment by entry id, by a text match
   on its summary or destination, or the most recent one, and appends the `noted` event through the
   executor, so `/note` in chat and the model's tool call share one path. The `add_note` entry itself
   holds no text.
5. **A note made while a payment waits for a yes follows it.** The executor copies the awaiting
   entry's note onto the executed entry when the confirmation lands, so "pay …, note: X" then "yes"
   leaves one noted payment.

## Consequences

- Notes cost one event per edit and one migration (`0014_notes.sql` widens the event type check).
- The model sees the note the user typed (it is in the chat) and may call `add_note`; it cannot send
  a note anywhere, because no tool takes one as a memo and the executor strips `privateNote`.
- Cash App's notes are per-counterparty threads; ours are per-payment and one line. Reminders,
  search across notes and a web view are not here yet.
