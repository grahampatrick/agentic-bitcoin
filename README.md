# Agentic Bitcoin

**An assistant that holds, sends, and spends your bitcoin the way it was designed to work: sent
directly from one party to another, without going through a financial institution.**

Text it on Signal. It can buy bitcoin on a schedule, pay a Lightning invoice, order goods in sats,
rent compute by the second, or settle up with a friend — from *your* wallet, with *your* limits, and
without us ever holding keys or money.

> The rules every change is reviewed against live in [`docs/principles.md`](./docs/principles.md).
> Decisions are recorded in [`docs/adr/`](./docs/adr/). This README is how to run the code.

## Status

Live at **https://agentic-bitcoin.vercel.app**, with a sandbox at `/demo`. The landing page, policy
engine, ledger, agent, Signal bot and every rail (Lightning wallet over NWC, Strike, Bitrefill,
L402 compute, on-chain sweep) are implemented and tested. Real payments have been made end to end
over Signal with a user-paired Lightning wallet. Public access is by invitation while the
operator side is finished; see [`docs/launch-checklist.md`](./docs/launch-checklist.md).

## Prerequisites

- Node ≥ 22.18 (native TypeScript execution for the brand build)
- pnpm 9 (`npm i -g pnpm@9` or `corepack enable`)

## Setup

```bash
pnpm install
pnpm --filter @agentic-bitcoin/brand build   # generate tokens.css
```

## Develop

```bash
pnpm dev        # builds brand tokens, then runs the web app on http://localhost:3900
```

The price feed needs no keys (mempool.space, CoinGecko fallback, 60s server cache). The `/text`
waitlist works out of the box with a non-durable in-memory store; for durable storage copy
`apps/web/.env.example` → `apps/web/.env.local`, fill in the Supabase values, and apply the
migrations: `DATABASE_URL='<session-pooler string>' scripts/migrate.sh` (idempotent; or paste each
file from `supabase/migrations/` into the SQL editor in order).

## Try it in 30 seconds (no credentials)

```bash
pnpm demo        # a scripted conversation through the real policy engine, executor and ledger, with fake sats
```

Or open the live sandbox at https://agentic-bitcoin.vercel.app/demo — fake sats, real rules, with the ledger
and limits updating beside the chat. With `ANTHROPIC_API_KEY` set (locally or on Vercel) the real model
understands the messages; without it a scripted model does, and the page says so.

## Run the Signal bot

The bot talks to Signal through a `signal-cli` daemon that holds the bot's own Signal number; the
bot process only speaks HTTP to it. [`docs/signal.md`](./docs/signal.md) walks through the number,
registration, the daemon, and a linked-device test mode for trying it on your own account first.

```bash
cp apps/bot/.env.example apps/bot/.env    # SIGNAL_ACCOUNT, SECRETS_KEY, ANTHROPIC_API_KEY
pnpm --filter @agentic-bitcoin/bot start   # fake wallet until you /pair; file-backed stores without Supabase
```

In chat: `/start` (three-question limits wizard) → `/pair <nostr+walletconnect://…>` (budgeted
strings only) → “what's my balance?” → `/key strike …` / `/key bitrefill …` for the other rails.
Giving: “which churches can I give to?”, “tithe 20000 sats to grace-fellowship every sunday”,
`/recipient add <lightning address> <name>` for your own recipients, `/statement` for the year's
gifts. The operator's directory is `RECIPIENTS_FILE` (see `apps/bot/recipients.example.json` and
[`docs/recipients.md`](./docs/recipients.md)).
Receiving: a church, missionary or creator onboards at `/receive` with a Lightning address or a
receive-only wallet connection and gets `slug@<host>`, `/give/<slug>`, `/tip/<slug>` and a tip button;
every invoice is minted by their own wallet (ADR-0014). The operator lists them with `/verify <slug>`.
Virtual Lightning cards: "create a card for steam with a 50,000 sat monthly limit" makes a named, scoped budget on
the user's own wallet (never a balance), enforced by the executor and tagged in the ledger, with a card page to pause it;
the store's `/shop/cards` builder makes one on the web, claimed from chat with `/cards claim`
([`docs/cards.md`](./docs/cards.md), ADR-0021).
Replace the bitcoin you spend: `/replace on` buys the value of every spend back on the user's own Strike account and
sweeps it into their wallet, derived from the ledger so each spend is replaced at most once
([`docs/replace.md`](./docs/replace.md), ADR-0022).
Pay bills with bitcoin: "pay my rent, $450 to landlord@example.com on the 1st" schedules a payment from the user's own
wallet, priced on the day, paid automatically or parked for a yes with "ask me first"
([`docs/bills.md`](./docs/bills.md), ADR-0023).
Private transaction notes: "pay 500 sats to x@y, note: plumber deposit" keeps a note on the payment in the user's own
ledger, sealed at rest and never sent to the payee; `/note`, `/notes` ([`docs/notes.md`](./docs/notes.md), ADR-0024).
The commerce protocol: four endpoints any Lightning shop can serve so any agent can buy from it, with the shop's own
invoice and the preimage as receipt; Anvard serves it for its merchants and consumes it from remote shops, mirrors their
feeds, and imports CSV/Shopify inventory; trading cards carry set, condition, grade and provenance
([`docs/protocol/anvard-commerce.md`](./docs/protocol/anvard-commerce.md), ADR-0020). Discord is the player surface, DMs only.
The store: `/shop` is a Lightning marketplace in the Shop-app shape (search, categories, a featured merchant, deals, cart);
every order is one invoice minted by the merchant's own wallet, shipping is sealed for the merchant alone, and "find me
a study bible" / "buy <id>" work from Signal (ADR-0016, [`docs/shop.md`](./docs/shop.md)).
Paying is one tap: `lightning:` links, browser wallets via WebLN with the preimage posted back as proof, named wallet
buttons; `/connect` pairs your own Alby Hub or Coinos with a budget pre-filled; `/address yourname` gives you
`yourname@anvard.ai` paying straight into your wallet (ADR-0019, [`docs/wallets.md`](./docs/wallets.md)).
Invoices: “invoice Bob $200 for the deck due friday” returns a pay link whose Lightning invoice your own wallet minted;
organisations create, void and export invoices from their dashboard; `pay this <link>` pays one from chat (ADR-0018,
[`docs/invoices.md`](./docs/invoices.md)).
Sats-back: store purchases earn 1% back, paid from the operator's wallet to the buyer's own wallet through the same
executor and caps, never a balance held with us (ADR-0017, [`docs/rewards.md`](./docs/rewards.md)).
Campaigns: a recipient opens a goal from their dashboard; supporters pledge from chat (“support
ortiz-family $25 a month”), follow updates with `/follow`, and see progress at `/campaigns/<slug>` (ADR-0015).

Referral rewards: `/refer` gives you an invite code and a link; a friend who joins with it and makes a first payment
of at least the minimum earns you both flat sats, recorded as ordinary rewards and paid from the operator's wallet to
each person's own wallet. One referral per person, before their first payment, qualified from the ledger (ADR-0025).

Your workspace on the web: `/web` in chat replies with a private 30-day link to `/me`, an account area in the manner of
a settings page: invites and contact, a vault (wallet, address, cards, cold storage, keys), trusted and blocked
destinations, limits and rails, the kill switch, connectors. No password: chat is the key, and the page is a view over
the same rows the bot writes; secrets never reach it. `/web revoke` cuts every link off (ADR-0027, docs/workspace.md).

### Self-host with Docker

```bash
docker compose up -d        # bot + signal-cli daemon; see docker-compose.yml and docs/launch-checklist.md
```

## Quality gates (what CI runs)

```bash
pnpm lint        # biome + money-as-integers gate
pnpm typecheck   # tsc --noEmit across packages
pnpm test        # vitest (+ brand token drift check)
pnpm build       # next build
```

## Layout

```
apps/web            Next 15: landing, /text, /demo, /status, /give, /give/<slug>, /tip/<slug>, /campaigns/<slug>, /shop/*, /pay/<token>, /rewards, /receive, LNURL-pay, /api/*
packages/core       actions, policy engine, ledger, rail contracts, fakes, executor (no deps)
packages/rails      NWC wallet, L402 compute, Strike exchange, Bitrefill goods, LND on-chain, secrets
packages/scheduler  cron parser, durable schedules, minute runner (every run is an Action)
packages/agent      tool defs from the Action union, prompt, model loop, evals
packages/mcp        MCP server (stdio + HTTP) over the same tools
apps/bot            Signal chat surface, dispatcher, onboarding, giving commands, stores
packages/stores     Supabase stores shared by bot and web (storefront)
packages/fixtures   shared test data for every package
packages/brand      design tokens → tokens.css
docs/adr            architecture decision records
supabase/migrations waitlist table
```

## Principles (short version)

Non-custodial. Policy before rail. Money is integers. Every action in the ledger. Untrusted text
is data. One wallet socket. Fixtures first. No secrets in git. No advice. See
[`docs/principles.md`](./docs/principles.md).

## Licence

MIT — see [LICENSE](./LICENSE).
