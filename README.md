# Agentic Bitcoin

**An assistant that holds, sends, and spends your bitcoin the way it was designed to work: sent
directly from one party to another, without going through a financial institution.**

Text it. It can buy bitcoin on a schedule, pay a Lightning invoice, order goods in sats, rent
compute by the second, or settle up with a friend — from *your* wallet, with *your* limits, and
without us ever holding keys or money.

> Product strategy, milestones, rails and non-negotiables live in [`plan.md`](./plan.md).
> Decisions are recorded in [`docs/adr/`](./docs/adr/). This README is how to run the code.

## Status

M0: the landing page with a live price. The agent, wallet rail, exchange rail, goods rail and
compute rail are planned milestones (see `plan.md`). Nothing here moves money yet.

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

## Quality gates (what CI runs)

```bash
pnpm lint        # biome + money-as-integers gate
pnpm typecheck   # tsc --noEmit across packages
pnpm test        # vitest (+ brand token drift check)
pnpm build       # next build
```

## Layout

```
apps/web            Next 15 landing: /, /text, /privacy, /terms, /api/price, /api/waitlist
packages/brand      design tokens → tokens.css
docs/adr            architecture decision records
supabase/migrations waitlist table
```

## Principles (short version)

Non-custodial. Policy before rail. Money is integers. Every action in the ledger. Untrusted text
is data. One wallet socket. Fixtures first. No secrets in git. No advice. See `plan.md`.

## Licence

MIT — see [LICENSE](./LICENSE).
