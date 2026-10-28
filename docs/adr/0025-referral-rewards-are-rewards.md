# ADR-0025 — Referral rewards are ordinary rewards, qualified from the friend's ledger

**Date:** 2026-10-28 · **Status:** accepted · M22

## Context

Block's roadmap lists "referral rewards in sats": invite a friend, both get bitcoin once the friend
does something real. We want that without a balance, a second payment path, or a counter that
can drift from what actually happened.

## Decision

1. **One code per user, one referral per friend.** A code is six characters from an alphabet without
   0/O/1/I, minted on first ask and stable after. A friend is linked to exactly one referrer, once,
   and only before the friend's first payment: a first message that is a code, or `/join <code>`
   later. Self-referral is refused. A friend's code also satisfies the operator's invite gate.
2. **Qualifying is read from the ledger.** The friend qualifies when their first `succeeded` spend of
   at least `qualifyingSats` lands at or after they joined. The check runs after any spend (chat,
   confirmation, scheduled) and is idempotent: the referral records the qualifying entry id once.
3. **The rewards are M13 rewards.** Qualifying creates up to two flat rewards with source `referral`,
   keyed `ref:<referral id>:referrer` and `ref:<referral id>:friend`, payable at once (a Lightning
   payment is final; there is no returns window). They are the operator's liability, paid from the
   operator's own wallet by the same payout run as sats-back, to an invoice each person's own paired
   wallet mints (ADR-0017). Nothing is paid on request and nobody holds a balance with us.
4. **Amounts and limits are operator configuration.** `REFERRAL_REWARD_SATS` (referrer),
   `REFERRAL_FRIEND_SATS` (friend), `REFERRAL_MIN_SPEND_SATS` (the first payment), and
   `REFERRAL_MAX_PER_MONTH` (referrer rewards per UTC month; friends past it still qualify and still
   get theirs). The programme is off until a side pays something.

## Consequences

- No new rail, store of value, or payout code: the referral store holds codes and links only.
- The web page `/join/<code>` and the bot state the same terms from the same env names.
- Abuse is bounded by the qualifying payment (sats must actually leave the friend's wallet), the
  monthly limit, the operator's daily payout cap, and one referral per chat identity. A determined
  person with many numbers can still farm `friendSats + referrerSats` per qualifying payment; the
  operator sets those below the cost of doing so.
