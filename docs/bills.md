# Pay bills with bitcoin

A bill is a recurring payment from your own wallet to a Lightning address you name: rent, a phone
plan, a subscription, anyone who takes sats. In dollars (priced on the day) or fixed sats.

**Set one up in chat:** "pay my rent, $450 to landlord@example.com on the 1st" · "pay phone plan
20,000 sats to bills@carrier.example on the 15th, ask me first". The assistant shows the summary;
reply yes. Without "ask me first" the bill pays on the day within your limits; with it, you get the
bill on the day and reply yes to pay or no to skip.

**See and stop them:** `/bills` (with the next date) · `/bills cancel <id>` · in chat, "my bills" and
"stop paying rent".

**Rules that still apply:** your per-action and daily caps, allow and deny lists, the kill switch. A
denied bill is reported once and shows in `/ledger`. The payee must be a Lightning address you gave;
giving to a church or missionary by name goes through the verified directory instead.

Self-hosting: migration `0013_bills.sql`. ADR-0023 has the reasoning.
