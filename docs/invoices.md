# Invoices and payment requests

Bill someone and get paid over Lightning, with the invoice created by your own wallet (ADR-0018).

## From chat

- `invoice Bob $200 for the deck due friday` → a pay link to send Bob. Due dates: a weekday, "in 7 days",
  "tomorrow" or YYYY-MM-DD.
- `request $18 from Alice for dinner` → the one-line version.
- `invoice Grace Church $500 for sound tech monthly` → a schedule that issues a fresh invoice on the 1st,
  due 14 days later. "What recurring gifts do I have" lists it; "cancel sch_…" stops it.
- `/invoices` shows open, overdue and paid with links; `/invoices csv` gives the year's records.
- `who hasn't paid me?` / `my paid invoices`; `void inv_…` cancels an unpaid one.
- "Remind Bob" gives you a short note with his link to forward; we never message payers.
- Received one of our links? `pay this <link>` pays it through your limits.

You need a paired wallet (`/pair`); the invoice is minted there, so it is yours the moment it is paid.
The bot tells you when it lands.

## From the dashboard (organisations and merchants)

`/receive/<slug>` has an Invoices section: create (items, quantities, prices in dollars, optional sealed
contact, due date), void, mark paid outside Lightning, download CSV. The Lightning invoice is created
on your wallet when the payer opens the link, and renewed if it expires.

## The pay page

`/pay/<token>`: items, total in dollars and sats, QR and `lightning:` link, status. If your wallet is
connected the page notices the payment; otherwise the payer pastes the preimage their wallet shows.
