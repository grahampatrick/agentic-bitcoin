# Referral rewards in sats

Invite a friend; when they make their first payment, you both get sats in your own wallets
(ADR-0025). Referral rewards are the same kind of reward as sats-back (ADR-0017): a promise from
the operator, paid from the operator's wallet, never a balance.

## For users

- `/refer` (or `/invite`, or "how do I invite a friend?"): your six-character code, your link
  `<site>/join/<code>`, the terms, and your tally (joined · qualified · sats earned).
- A friend joins by sending your code as their very first message, or `/join <code>` any time
  before their first payment. One referral per person; it cannot be changed; you cannot use your own.
- The friend qualifies with their first payment of at least the minimum (default 1,000 sats). Both
  rewards are recorded at once and paid by the next payout run to an invoice each wallet creates.
  `/rewards` shows pending, payable and paid; a message arrives when a payout lands.

## Operator setup

- `REFERRAL_REWARD_SATS`: what the referrer earns per qualified friend (0 = nothing).
- `REFERRAL_FRIEND_SATS`: what the friend earns on their first qualifying payment (0 = nothing).
  The programme is off until one of these is above zero.
- `REFERRAL_MIN_SPEND_SATS` (default 1000): the friend's first payment must be at least this.
- `REFERRAL_MAX_PER_MONTH` (default 10): referrer rewards per UTC month. Friends beyond it still
  qualify and still get theirs; the referral records why the referrer was skipped.
- Payouts need `REWARDS_NWC_URL` and run under `REWARDS_DAILY_CAP_SATS` like sats-back.
- Set the three `REFERRAL_*` amounts on Vercel too, so `/join/<code>` states the same terms.
- Supabase: migration `0015_referrals.sql` (`referral_codes`, `referrals`, and `referral` as a
  reward source). File and memory stores need nothing.
- `BOT_INVITE_CODE`: when the gate is on, a friend's referral code also opens it.

## Rules the code enforces

- Qualifying is derived from the friend's ledger after every spend (chat, confirmation, schedule),
  never from a counter, and happens once per referral.
- Rewards are flat, keyed by referral id and side, so a batch is never recorded or paid twice.
- Codes never contain 0, O, 1 or I; what people type is upper-cased and stripped of spaces and dashes.
