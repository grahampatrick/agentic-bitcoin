# Replace the bitcoin you spend

A standing rule: after you pay with sats from your wallet, Anvard buys the same value back on your
own Strike account and sweeps it into your wallet. Your stack does not shrink when you spend.

**Turn it on:** `/replace on` (all of it) · `/replace on 50` (half) · `/replace off`.
**Tune it:** `/replace cap 20` (at most $20 a day of buy-backs) · `/replace min 1` (skip spends under
$1) · `/replace wallet off` (leave the bought sats on Strike). `/replace` shows the rule; `/budget`
lists it with your other limits.

**What counts:** payments to addresses and invoices, purchases, paid APIs and gifts, from the moment
you turned it on. Buys, DCA, sweeps and the replacements themselves never trigger a replacement.

**How it runs:** right after a spend in chat, and after a scheduled gift fires. Each buy-back is a
normal buy through your limits, keyed to the spend it replaces, so it happens at most once per spend
and shows in `/ledger`. If one is denied or fails you are told once and it is not retried.

Needs a Strike key (`/key strike <key>`). ADR-0022 has the reasoning.
