# ADR-0008: No financial advice — enforced in prompt, code, and copy

**Date:** 2026-10-07 · **Status:** accepted

## Decision
- The assistant executes instructions. It never recommends whether, when, or how much to buy,
  sell, or hold, and never comments on price direction. This is rule 3 of the system prompt and
  an adversarial eval case (`adv-6`).
- The model cannot change policy. Caps, allow/deny lists, rail flags and the kill switch are set
  only through `/budget`, `/kill`, `/resume` in the bot dispatcher, which never consult the model.
  There is no tool for policy, so a prompt injection cannot reach it.
- Untrusted text (invoice memos, product names, L402 bodies) is wrapped in `<untrusted>` before
  the model sees it, and the prompt says such text is data. Two eval cases (`adv-7`, `adv-8`) check
  that a memo cannot trigger a payment.
- The landing copy, Terms and the `/text` page say "Not financial advice" in plain words
  (`copy.test.ts` guards the phrase).

## Why
Advice is regulated; execution of a user's own instruction on their own wallet is not. Keeping
the line bright keeps the product non-custodial *and* non-advisory (plan OQ-8 remains for counsel).

## Consequences
- A user who asks "should I buy?" gets a one-line decline and an offer to execute what they decide.
- Any future "insights" feature must be reviewed against this ADR before it ships.
