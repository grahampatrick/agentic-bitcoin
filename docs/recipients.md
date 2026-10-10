# Recipients and verification

Agentic Bitcoin can give to a **recipient**: a church, a missionary, a creator or a merchant with a
Lightning address. We never hold the money; a gift is a Lightning payment from the giver's wallet
to the recipient's. This page is the standard for what "verified" means.

## Two kinds of recipient

| | Directory | Private |
|---|---|---|
| Who sees it | Everyone, once verified | Only the user who added it |
| Who adds it | The operator (`RECIPIENTS_FILE` or the database) | The user: `/recipient add <lightning address> <name>` |
| May receive gifts | Only when verified | Always, from its owner |
| Slug | Assigned by the operator | Derived from the name the user typed |

## Verification

A directory entry is verified in one of two ways, recorded as `verified.how`:

- **domain** — the Lightning address answers LNURL-pay (`https://<domain>/.well-known/lnurlp/<name>`)
  *and* the recipient's website is on that domain (or a subdomain). The recipient controls both, so
  the address is theirs. A church at `grace-fellowship.org` with `give@grace-fellowship.org` is
  domain-verified; one using `give@getalby.com` is not, because the wallet provider owns that domain.
- **operator** — the operator has confirmed the address with the recipient directly (a call, a
  known relationship, a signed statement) and sets `"verified": true` in the directory file.

Unverified directory entries are listed nowhere and the policy denies gifts to them
(`RECIPIENT_UNVERIFIED`). Verification is re-checked by the scheduler before every recurring gift.

## What we are not

We are not the donee. No gift passes through us, and we issue no receipts or tax documents.
`/statement [year]` gives the user their own CSV record of gifts; the recipient issues receipts.

## Self-onboarding (web /receive)

A church, missionary or creator can onboard themselves at `/receive` with either a Lightning address
they already have or a **receive-only** wallet connection (Nostr Wallet Connect with `make_invoice`
and `lookup_invoice` only; connections that can pay are refused). They immediately get:

- a Lightning address `slug@<our host>` and pages at `/give/<slug>` and `/tip/<slug>`,
- a tip button snippet for their own site,
- a dashboard link (shown once) listing invoices and, where their wallet supports it, settlement.

They are **unlisted and cannot receive from our users until verified**: the operator confirms the
address with them directly and runs `/verify <slug>` in the bot (`/verify` alone lists pending
entries; `/verify revoke <slug>` undoes it). See ADR-0014.

## Campaigns

From the dashboard a recipient can open a **campaign**: a goal supporters pledge to, either dollars
per month or a total in sats, with a story and updates. Supporters pledge from chat ("support
ortiz-family $25 a month"), give once from the campaign page, or follow updates with `/follow <slug>`.
Progress is computed from gifts we observed (deduplicated by payment hash) plus any the recipient
reports from outside Lightning, which are labelled as reported. See ADR-0015.

## Operator checklist for adding a church or missionary

1. Get their Lightning address from them directly, not from a web page.
2. Run the probe (it is what `/recipient add` does): the address must answer LNURL-pay.
3. If their website is on the same domain as the address, the entry is domain-verified
   automatically; otherwise confirm the address with them and set `"verified": true`.
4. Add the entry to `RECIPIENTS_FILE` (see `apps/bot/recipients.example.json`) and restart the bot,
   or insert the row into `recipients` when running on Supabase.
5. Give them 21 sats from the bot and confirm they received it.
