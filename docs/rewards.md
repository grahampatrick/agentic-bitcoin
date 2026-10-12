# Sats-back

Purchases in the store earn sats-back (default 1%), paid to the buyer's own wallet from the operator's
wallet (ADR-0017). `/rewards` in chat and `/rewards` on the web show pending, payable and paid.

## Operator setup

- `REWARDS_NWC_URL`: a budgeted NWC string for the wallet that funds payouts (never a user's).
  Without it rewards accrue and show as payable, but nothing is paid.
- `REWARDS_DAILY_CAP_SATS` (default 50,000): the operator policy's daily cap for payouts.
- `REWARDS_BPS_DIRECTORY` (default 100 = 1%), `REWARDS_BPS_BITREFILL` (default 0 until OQ-16),
  `REWARDS_MIN_PAYOUT_SATS` (default 100).
- Supabase: migration `0008_rewards.sql`. The same `REWARDS_BPS_DIRECTORY` should be set on Vercel so the
  web page states the same rate.

## Rules

- Digital goods: payable after 1 day. Physical goods: after 14 days. At most 100,000 sats per purchase.
- Payouts run from the bot's minute loop and are batched per payee once payable sums reach the minimum.
- Chat buyers are paid to an invoice created on their paired wallet; web buyers to the address given at
  checkout. Pending rewards are our liability, not a balance.
