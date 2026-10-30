# The shop plan

Selling on Anvard costs a flat monthly plan after a free pilot. Everything else stays free: tips,
pay links, invoices, campaigns, giving, and every personal use of the assistant.

**For a merchant.** Your portal's Plan page shows the state (pilot, active, payment due, lapsed),
the date, the price, and a Pay button. Paying opens an ordinary Anvard invoice issued by the operator;
pay it from any Lightning wallet. A month is added from the later of your paid-through date and the
day you pay, so paying early never loses you days. If the plan lapses after the grace period, your
products leave the shop and checkout closes; your pay links, tips and invoices keep working, paid
orders stay yours, and paying turns everything back on the moment it settles.

**For the operator.** Onboard yourself as a recipient at `/receive` with a receive-only wallet
connection, then set on the web:

- `PLAN_PAYEE_SLUG` — your recipient slug (the plan invoices are issued by it).
- `PLAN_SHOP_USD_CENTS` — the monthly price in cents (`2100` = $21). Unset or `0` = plans off.
- `PLAN_PILOT_DAYS` (60) and `PLAN_GRACE_DAYS` (14).

The pilot starts when a merchant onboarded (or when first seen). To grandfather a merchant, set
`paid_through_at` on their `merchant_plans` row. Supabase: migration `0017_plans.sql`. ADR-0028 has
the reasoning.
