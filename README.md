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
`apps/web/.env.example` → `apps/web/.env.local`, fill in the Supabase values, and apply
`supabase/migrations/0001_waitlist.sql`.

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
apps/web            Next 15 landing: /, /text, /demo, /status, /privacy, /terms, /api/*
packages/core       actions, policy engine, ledger, rail contracts, fakes, executor (no deps)
packages/rails      NWC wallet, L402 compute, Strike exchange, Bitrefill goods, LND on-chain, secrets
packages/scheduler  cron parser, durable schedules, minute runner (every run is an Action)
packages/agent      tool defs from the Action union, prompt, model loop, evals
packages/mcp        MCP server (stdio + HTTP) over the same tools
apps/bot            Signal chat surface, dispatcher, onboarding, giving commands, stores
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
