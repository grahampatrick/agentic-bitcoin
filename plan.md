# plan.md — Agentic Bitcoin

A Compound Engineering plan for **an AI assistant that can perform every bitcoin action a person
can** — hold, receive, send, buy on a schedule, pay for goods, pay for compute — over Lightning,
non-custodially, from a text message. Marketed with a landing page that copies the radical
simplicity of instinct.com and speaks in the words of the Bitcoin whitepaper.

> **Decisions locked (2026-10-07):**
> - Name: **Agentic Bitcoin**. Repo: `~/Documents/agentic-bitcoin`. Dev port **3900**.
> - **Open source from the first commit.** MIT licence, public GitHub repo `grahampatrick/agentic-bitcoin`,
>   no secrets ever committed, every rail runnable against a fake or test backend without an account.
> - **Non-custodial. We never hold keys or money.** The agent spends through a *scoped* wallet
>   connection (Nostr Wallet Connect, NIP-47) that the user's own wallet issues with a budget.
>   Exchange purchases run on the *user's* exchange API key. Seed phrases never touch our code.
> - **One wallet socket, many merchants.** Every rail that needs to pay (goods, compute, people)
>   pays a BOLT11 invoice through the single wallet adapter. New rails are merchant adapters, not
>   new money plumbing.
> - **Every action passes the policy engine.** Budget caps, allowlists, confirm-above-threshold,
>   kill switch, append-only ledger. The LLM never touches a rail directly.
> - **The agent is an MCP server first, a chatbot second.** The same tool set powers our chat
>   assistant *and* any third-party agent (Claude Code, Claude Desktop, OpenAI Agents SDK).
> - **Signal is the chat surface** (GM, 2026-10-07). Telegram stays as the zero-cost dev surface because
>   its bot API needs no phone number; Signal ships via `signal-cli` (JSON-RPC daemon) on a dedicated number. SMS is dropped.
> - **No advice.** The agent executes instructions ("buy $25 every Friday"); it never recommends
>   when or whether to buy. Copy and system prompt both say so.
> - **Landing = instinct.com structure, whitepaper language.** Single column, no nav, no hero image,
>   one CTA, legal footer, plus a quiet live price line.

---

## Current State

Inventory as of 2026-10-07 (end of M0). Public repo: https://github.com/grahampatrick/agentic-bitcoin.
Live: **https://agentic-bitcoin.vercel.app** (Vercel project `agentic-bitcoin`, root directory `apps/web`).

| Path | Status |
|---|---|
| `LICENSE` (MIT), `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | Working |
| `.github/workflows/ci.yml` | gitleaks → brand build → lint → typecheck → test → build |
| `scripts/no-float-money.mjs` | Lint gate: float smell next to a money identifier fails the build |
| `packages/brand` | Tokens measured from instinct.com → `tokens.css`; drift check in `pnpm test` |
| `apps/web/app/page.tsx` + `home.css` + `globals.css` | Landing: 3 beats, 5 cursor-tracked reaction tasks, highlighter CTA, staggered reveal, reduced-motion |
| `apps/web/app/fonts/` | Vendored Newsreader + Inter variable latin woff2 + OFL texts (ADR-0003) |
| `apps/web/lib/price/*` | mempool.space → CoinGecko fallback, 60s cache, last-known-value on outage, integers only; 25 tests |
| `apps/web/components/LivePrice.tsx` | SSR first paint, 60s refresh, "updated Ns ago" |
| `apps/web/lib/copy.ts` + `copy.test.ts` | Verbatim whitepaper phrases + quote-drift and no-advice guards |
| `apps/web/lib/waitlist/*`, `/api/waitlist`, `/text` | Email **or npub** waitlist, memory store with Supabase opt-in; 17 tests |
| `/privacy`, `/terms` | Plain-language, non-custodial, no-advice |
| `docs/adr/0001–0003` | Open-source/non-custodial, clone boundaries, fonts |
| `packages/core` (M1) | `money` (sats/cents as bigint, snapshot conversions), `action` (9-kind union, canonical hash), `policy` (ordered gates), `ledger` (event-sourced, window budget), `rails` (4 contracts + typed errors), `fakes`, `executor`; 85 tests incl. contract suite |
| `packages/fixtures` (M1) | Actions, policies, synthetic invoices, L402 challenge, Strike quote, Bitrefill invoice shape, price snapshot |
| `docs/adr/0004–0005` | Money as integers; policy before rail |
| `packages/rails` (M2) | `NwcWalletRail` (decode-before-pay, hash-lookup recovery, UNKNOWN_STATE on timeout, redaction), Breez stub, AES-GCM secrets; 23 tests; env-gated live contract run + `demo:pay` |
| `docs/adr/0006`, `docs/testing.md` | NWC as the wallet socket; how to get a budgeted test connection |

- **Working:** everything above; 46 tests; all gates green locally; deployed.
- **Scaffolded:** nothing half-done.
- **Missing (M3+):** L402, Strike and Bitrefill rails; agent; MCP server; Signal/Telegram bot; scheduler; Supabase ledger store. **M2 live verification** against a real wallet still to run.

**M0 lessons (recorded so they are not re-learned):**
- `next/font/google` crashed inside Vercel's build (`Cannot read properties of null` in its CSS parser). Fonts are vendored; builds make no network calls.
- A brand token that references a CSS variable of its *own name* on `:root` is a cycle; the browser drops the declaration (we shipped Times for ten minutes). next/font variables are `--font-newsreader` / `--font-inter`, tokens are `--font-serif` / `--font-sans`.
- `.marketing-site h1` / `.marketing-site a` element resets have (0,1,1) specificity; utility classes must be scoped `.marketing-site .x` to win.
- React 19 diffs even extra attributes on `<html>` at hydration; the reveal gate sets `data-reveal` plus `suppressHydrationWarning` on that one element.
- Never run `next build` while `next dev` is running in the same app dir; they share `.next` and the dev server breaks.
- Vercel refused Next 15.1.6 as vulnerable; we are on 15.5.27 (the `backport` tag). Monorepo deploys need the project's Root Directory set to `apps/web` (done via API; the CLI has no flag).
- The Claude preview launcher cannot spawn processes under `~/Documents`; the launch config is attach-only on :3900 and the dev server is started by hand.

Adjacent assets outside this repo (reuse, do not reinvent):

| Asset | What to reuse |
|---|---|
| `~/Documents/tinysats` | Proven **pnpm monorepo skeleton**: Next 15, Biome, vitest, tsc gates, `ci.yml`, brand-token pipeline. M0 copies the skeleton. |
| `~/Documents/zapgram` (`packages/rails`) | **Payment-rail adapter contract** + contract test suite + money-as-integers ADR. M1/M2 import the shape: `createInvoice / payInvoice / getBalance / listTransactions`, sats as `bigint`/integer, never floats. |
| `~/.hermes` (Telegram chatbot) | Working **Telegram bot plumbing** and lessons on API-key vs OAuth auth. M3 lifts the bot scaffold, not the code. |
| Start9 server (Bitcoin Knots + Electrs) | Host **Alby Hub** (or LNbits) as the dogfood wallet that issues the NWC connection. Also the regtest/signet backend for CI-adjacent manual tests. |
| `~/Documents/useful-book`, Zapgram | First "pay a person" demo targets (Lightning addresses GM controls). |

Local dev port: **3900** (3100–3800 are taken by other projects).

### Reference: what instinct.com actually is (measured 2026-10-07)

Captured with the browser from the live site, so the clone is exact rather than vibes:

- **Document:** `header` (logo only, 28px wide, 34px at ≥80rem) → `main.home` (flex column,
  `justify-content: space-between`, min-height 100dvh) → `.home__intro` (max-width **41rem**,
  gap `1.9 × font-size`, `margin-bottom: 20vh`) → `.legal-links` (13px, copyright + Privacy + Terms).
- **Type:** one size for everything in the intro: **24px / 130% line-height / −0.01em**.
  `h1` is `<strong>` inside an `h1` with font-weight 600; paragraphs weight 400.
  Fonts are proprietary (**Aime** serif for intro, **Melange** sans for legal) — we substitute
  OFL fonts (see Open Questions). Body background `#fff`, text **`#1f2322`** (onyx-450),
  outer page `#f4efec` (sand-100), accent underline **`#e1d5cd`** (sand-400), selection teal `#73a89a`.
- **Task phrases** (`.home__task`): underline 1px `rgba(31,35,34,.2)`, offset `calc(.1em + 1px)`;
  on hover the underline goes solid and a **round 35.6px sand-400 "reaction" bubble** with a 20px
  icon pops in with a spring (`--ease-pop` linear() curve, scale .5s, opacity .12s).
- **CTA** (`.cta`): weight 600, **thick underline `.42em` sand-400 at `-0.2em` offset**
  (a highlighter effect), `text-decoration-skip-ink: none`, chevron `0.9em` inline SVG, hover darkens to `#d3c3b8`.
- **Reveal:** header, each intro child, and legal links fade/slide in with `home-reveal .6s
  cubic-bezier(.22,1,.36,1)` staggered 90ms (`--reveal: 1..5`); reduced-motion gets a plain fade.
- **Copy structure (three beats + CTA):** (1) *what it is*, (2) *"The interface is simple: there are
  no new interfaces…"*, (3) *"It can help you …"* with five underlined example tasks, then
  "Text Instinct →". Links: `Text Instinct` → app login, `Privacy policy`, `Terms of service`.

### Reference: whitepaper phrases we are allowed to lean on

Verbatim from Nakamoto (2008), to be used as the voice of the page (short quotes, attributed in
the footer line "Phrases from the Bitcoin whitepaper, 2008"):

- "A purely peer-to-peer version of electronic cash would allow online payments to be sent directly
  from one party to another without going through a financial institution."
- "based on cryptographic proof instead of trust, allowing any two willing parties to transact
  directly with each other without the need for a trusted third party"
- "small casual transactions"
- "The network is robust in its unstructured simplicity."
- "Nodes can leave and rejoin the network at will"
- "proof-of-work" / "one-CPU-one-vote" (for the compute rail copy)

---

## North Star

A person texts "buy $25 of bitcoin every Friday, keep 50k sats on Lightning, and pay for my GPU
time from that" — and from then on it just happens, from their own wallet, with every action logged
and every large one confirmed, and nobody but them ever holds the keys.

---

## Product shape

### How the agent performs bitcoin actions (the rails)

| Action the user asks for | Rail | Backend (open source path first) | Status of the ecosystem (verified 2026-10) |
|---|---|---|---|
| Check balance, receive, **send sats / pay an invoice / pay a Lightning address** | **Wallet** | **NWC (NIP-47)** via `@getalby/sdk`. Works with Alby Hub (self-hostable on Start9), Coinos, Primal, Zeus, LNbits, Mutiny-style wallets. Fallback: Breez SDK Nodeless (no node, has an MCP server). | Mature. Dozens of wallets implement the NWC wallet service; NWC budgets + expiry are enforced wallet-side. |
| **Buy bitcoin / DCA** | **Exchange** | **Strike API**: create exchange quote (USD→BTC) → execute before expiry; scoped API keys; 422 `BALANCE_TOO_LOW`. Alternatives: Coinbase Advanced Trade, Kraken. River/Swan have **no public API** today. | Strike is the only Lightning-native exchange with a public, scoped REST API. Our scheduler owns the cadence, not Strike's. |
| **Buy products** (gift cards, phone top-ups, eSIMs → effectively anything on Amazon/Uber/etc.) | **Goods** | **Bitrefill Personal API** (Bearer token) → invoice create → pay BOLT11 through the wallet rail → poll invoice until *delivered* (payment ≠ delivery). | Bitrefill ships an agent skill + MCP already; their own guidance: never auto-approve purchases. |
| **Buy compute / inference / any paid API** | **Compute (L402)** | **L402 client**: request → HTTP 402 with invoice + macaroon → pay via wallet rail → retry with `Authorization: L402 <macaroon>:<preimage>`. Targets: `llm402.ai` (≈10 sats/request, open models), LightningProx (Anthropic/OpenAI/etc. behind L402), any Aperture-fronted API. | Lightning Labs' 2026 toolset (`lnget`, MCP node tools, scoped creds) confirms the direction; our client is a plain `fetch` wrapper, no LND required. |
| **Pay a person** | Wallet | Lightning address / BOLT11 / BOLT12 via NWC. | Same adapter as row 1. |
| **Move to cold storage** | On-chain (later) | Watch-only xpub + wallet's on-chain send (Breez SDK or node RPC). | M8. Not needed for the demo. |

**The architectural trick:** rails 3–5 are *merchant* adapters that only ever produce a BOLT11
invoice; the single wallet adapter pays it. So adding "buy a domain name in sats" or "tip a Nostr
post" is one small adapter and zero new trust.

### System layers

```
Chat surface (Telegram → SMS → web chat on landing)
        │  natural language
        ▼
Agent core (LLM tool-use loop)  ──────────────┐  same tools exposed as
        │  typed Action requests               │  @agentic-bitcoin/mcp (MCP server)
        ▼                                      │  for Claude Code / Desktop / other agents
Policy engine  (budgets, allowlists, confirm ≥ threshold, kill switch)
        │  approved Action
        ▼
Ledger (append-only, every attempt + outcome, money as integers)
        │
        ▼
Rails: wallet(NWC) · exchange(Strike) · goods(Bitrefill) · compute(L402) · scheduler(DCA)
```

### Landing page copy (v1, to be tuned in M0)

Mirrors Instinct's three beats + CTA. Whitepaper phrases in bold are *verbatim*; everything
else is ours.

1. **(h1, strong)** Agentic Bitcoin is an assistant that holds, sends, and spends your bitcoin the
   way it was designed to work: **sent directly from one party to another without going through a
   financial institution.**
2. The interface is simple: there are no new interfaces. You text it. It acts on **cryptographic
   proof instead of trust**, and it can transact with **any two willing parties** over Lightning —
   including the machines it hires to think.
3. It can help you <u>buy bitcoin every Friday</u>, <u>pay a Lightning invoice</u>, <u>order
   groceries in sats</u>, <u>rent GPU time by the second</u>, or <u>settle a bill with a friend</u>.
   (hover reactions: ₿ · ⚡ · 🛒 · 🖥 · 🤝 as inline SVG, no emoji)
4. **CTA:** Text Agentic Bitcoin →
5. **Live price line** (13px, under the CTA, tabular numerals): `1 BTC = $118,432 · 844 sats per dollar · updated 12s ago`
6. **Footer:** `Copyright © 2026 Agentic Bitcoin · Privacy policy · Terms of service · Source` +
   a second quiet line: *"Phrases from the Bitcoin whitepaper, 2008. Not financial advice. Non-custodial."*

---

## Milestones

### M0 — Repo, licence, and the landing page with live price

**Status: DONE 2026-10-07** (commits 2ac01b8…). 

**Goal:** A public repo whose only product is a pixel-faithful Instinct-style landing page that
shows a live bitcoin price, deployed to Vercel.

**Deliverables**
- [x] `git init`, MIT `LICENSE`, `README.md` (how to run), `CONTRIBUTING.md`, `SECURITY.md`
      (how to report a wallet-related bug privately), `.github/workflows/ci.yml`
- [x] pnpm workspace copied from tinysats: `apps/web` (Next 15, App Router), `packages/brand`
      (tokens → `tokens.css`), Biome, vitest, `tsc --noEmit`
- [x] `.claude/launch.json` → `agentic-bitcoin-web` on port 3900; `.env.example`; `.gitignore` covers `.env*`
- [x] `packages/brand/tokens.ts`: the measured Instinct values (`onyx-450 #1f2322`, `sand-100`, `sand-400`,
      `ivory-500`, `accent-teal`, type scale 24/130%/−0.01em, spacing xs…8xl, `--ease-pop` curve)
- [x] `apps/web/app/page.tsx` + `home.css`: header logo, intro (h1/strong, 2 paragraphs, 5 `.home__task`
      spans with reaction bubbles), CTA with highlighter underline + chevron, legal links; staggered reveal;
      `prefers-reduced-motion` fade; mobile at 375px with 16px gutters, no horizontal scroll
- [x] Logo: a simple line-drawn mark in the spirit of Instinct's stickman (a stick figure holding a ₿ coin,
      hand-drawn SVG, 28/34px) — ours, not theirs
- [x] Fonts: self-hosted OFL substitutes (see OQ-1), `font-display: swap`
- [x] `apps/web/app/api/price/route.ts`: server-side fetch of `https://mempool.space/api/v1/prices`
      (USD) with CoinGecko `simple/price` as fallback; **60s in-memory cache**; returns
      `{ usd: integer_cents, satsPerDollar: integer, asOf: iso, source }`; never exposes an upstream error to the page
- [x] `apps/web/components/LivePrice.tsx`: server-rendered first paint (no "loading…"), client refresh every 60s,
      tabular numerals, `updated Ns ago` ticks locally; degrades to last-known value if the route fails
- [x] `apps/web/app/privacy/page.tsx`, `apps/web/app/terms/page.tsx` (short, honest, non-custodial language)
- [x] `/text` route: until M7, the CTA opens a waitlist (email or Nostr npub) backed by the tinysats
      Supabase-or-memory waitlist pattern
- [x] Tests: `price.test.ts` (parsing, fallback, cache TTL, integer maths), `page.test.tsx` (copy
      contains the verbatim whitepaper phrases — a *quote-drift* guard), brand-token drift check
- [x] Deploy: Vercel project `agentic-bitcoin`, `vercel.json` cron-free; `NEXT_PUBLIC_SITE_URL` set
- [x] `docs/adr/0001-open-source-non-custodial.md`, `docs/adr/0002-landing-clone-boundaries.md`
      (we copy structure, spacing and interaction; we do **not** copy Instinct's fonts, logo, or copy)

**CE Principle:** The brand-token package and CI gates make every later UI (chat, dashboard) free
of design decisions; the price route is the first "server fetch + cache + integer money" pattern that
every rail adapter copies.

**Key pitfalls**
- Instinct's fonts are licensed; shipping them is a legal problem and ruins "open source". Substitute.
- Floats for money. `satsPerDollar` and `usd` are integers from day one or M1's ledger inherits a bug.
- Hammering mempool.space/CoinGecko from the client — the 60s server cache is not optional (CoinGecko free tier ≈30 req/min).
- "Live" without a first paint: SSR the cached value so the page never shows a spinner.
- Copying the page too literally (copy, logo, mascot) invites a takedown. Structure and style only; ADR-0002 draws the line.

**Definition of Done**
```bash
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build
curl -s localhost:3900/api/price | jq -e '.usd > 0 and .satsPerDollar > 0'
# browser check at 375px and 1440px: no horizontal scroll, hover reaction pops, price updates within 60s
```

---

### M1 — Action contract, policy engine, ledger (pure, offline)

**Status: DONE 2026-10-07.** Also shipped (not in the original list): `executor.ts`, the one path from Action to rail, with confirmation-hash binding and idempotent replay; `FakeGoodsRail`; `describeExchangeRail` / `describeGoodsRail` contract suites.

**Goal:** A dependency-free core package where every bitcoin action is a typed, policy-checked,
ledger-recorded request — testable with zero network.

**Deliverables**
- [x] `packages/core/src/action.ts`: discriminated union `Action = PayInvoice | PayAddress | MakeInvoice |
      GetBalance | BuyBitcoin | ScheduleBuy | BuyProduct | PayL402 | CancelSchedule`, all amounts `bigint` sats
      or integer cents, `idempotencyKey`, `requestedBy: 'user' | 'schedule' | 'agent'`
- [x] `packages/core/src/policy.ts`: `Policy { dailyCapSats, perActionCapSats, confirmAboveSats,
      allowDestinations[], denyDestinations[], killSwitch, rails: {wallet, exchange, goods, compute}: boolean }`
      and `evaluate(action, policy, ledgerWindow) → Allow | NeedsConfirmation | Deny(reason)`
- [x] `packages/core/src/ledger.ts`: append-only `LedgerEntry { id, action, decision, outcome, preimage?, at }`;
      in-memory store + `LedgerStore` interface (Supabase impl in M3)
- [x] `packages/core/src/rails.ts`: adapter interfaces — `WalletRail`, `ExchangeRail`, `GoodsRail`,
      `ComputeRail` — and `FakeWalletRail`, `FakeExchangeRail` deterministic fakes
- [x] `packages/fixtures`: canonical actions, policies, invoices (`lnbc…` test vectors), L402 challenge
      headers, Strike quote JSON, Bitrefill invoice JSON — **shared by every package's tests**
- [x] Contract test suite `packages/core/test/rail-contract.ts` (`describeWalletRail(factory)`) that any
      real adapter must pass
- [x] `docs/adr/0004-money-as-integers.md`, `docs/adr/0005-policy-before-rail.md` (numbers shifted: 0003 is fonts)

**CE Principle:** Fixtures + the contract suite mean M2/M4/M5/M6 each ship one adapter file and
reuse the same tests; the policy engine means the LLM layer (M3) can be wired with zero new safety code.

**Key pitfalls**
- Daily caps computed from the ledger *window*, not a counter, or restarts reset budgets.
- Idempotency keys on every pay action — Lightning retries double-spend otherwise.
- `NeedsConfirmation` must carry a human-readable summary (amount in sats **and** fiat at quote time).

**Definition of Done**
```bash
pnpm --filter @agentic-bitcoin/core test   # ≥ 40 cases incl. cap-exhaustion, kill switch, allowlist, idempotent replay
pnpm typecheck && pnpm lint
```

---

### M2 — Wallet rail: NWC adapter (real sats, test network)

**Status: CODE DONE 2026-10-07; live run pending a connection string.** Unit suite (23 tests, fake NIP-47 client) and
the contract suite on fakes are green. `pnpm test:wallet` and `demo:pay` are wired and env-gated but have **not** been
run against a real wallet yet: GM needs to issue a budgeted NWC string (docs/testing.md). Also shipped: core
`UNKNOWN_STATE` error code — a timed-out payment stays `pending` in the ledger (budget reserved) instead of `failed`.

**Goal:** The core can check balance, make an invoice, and pay an invoice/Lightning address through a
real wallet over Nostr Wallet Connect, with the wallet's own budget as a second fence.

**Deliverables**
- [x] `packages/rails/src/wallet/nwc.ts` using `@getalby/sdk` (`get_balance`, `make_invoice`, `pay_invoice`,
      `lookup_invoice`, `list_transactions`, `pay_keysend` optional); Lightning-address → LNURL-pay resolution
- [x] `packages/rails/src/wallet/breez.ts` **stub + ADR** (nodeless fallback; implement only if NWC proves insufficient)
- [x] Connection-string storage: encrypted at rest (AES-256-GCM via node:crypto, not libsodium — ADR-0006; key from env), never logged, redacted in errors
- [x] `packages/rails/scripts/demo-pay.ts` (`pnpm --filter @agentic-bitcoin/rails demo:pay`): "pay 21 sats to gm@<lightning address>" end-to-end through policy → ledger → NWC
- [x] (code) / [ ] (live run) Test harness: docker-compose `polar`/LNbits regtest **or** signet Alby Hub instructions in `docs/testing.md`;
      contract suite runs against it in `pnpm test:wallet` (opt-in, needs `NWC_URL`)
- [x] `docs/adr/0006-nwc-as-wallet-socket.md`

**CE Principle:** Every later rail pays through this file. The encrypted-secret pattern is reused for
Strike and Bitrefill keys.

**Key pitfalls**
- NWC `pay_invoice` can return before settlement on some wallets — poll `lookup_invoice` and record the preimage.
- Users will paste a connection string with *unlimited* budget; onboarding (M7) must insist on a budgeted, expiring one.
- Relay flakiness: timeouts + idempotent retry, never blind re-pay.

**Definition of Done**
```bash
pnpm test                                   # fakes, always
NWC_URL=... pnpm test:wallet                # contract suite against a real test wallet
NWC_URL=... pnpm tsx scripts/demo-pay.ts    # prints preimage + ledger entry
```

---

### M3 — Agent core, MCP server, chat surface (Telegram for dev, Signal for users)

**Goal:** A person can text the assistant on Telegram, ask for any M1 action in plain language, get a
confirmation prompt when policy says so, and see it executed and logged. The identical tools are
available as an MCP server.

**Deliverables**
- [ ] `packages/agent`: tool definitions generated **from** the `Action` union (one source of truth);
      system prompt with the no-advice rule and the "always show sats and fiat" rule; tool loop using the
      Claude API (read the `claude-api` skill before choosing model/params — see OQ-5)
- [ ] `packages/mcp` (`@agentic-bitcoin/mcp`): STDIO + Streamable HTTP; tools `get_balance`, `make_invoice`,
      `pay_invoice`, `pay_lightning_address`, `buy_bitcoin`, `schedule_buy`, `buy_product`, `fetch_l402`;
      **`confirm_action` tool** that surfaces `NeedsConfirmation` back to the host agent
- [ ] `apps/bot`: one `ChatSurface` interface with two adapters — Telegram (grammY; inline Confirm/Deny buttons) for
      development, and **Signal** via `signal-cli` JSON-RPC (text replies "yes"/"no" bound to the action hash, since
      Signal has no buttons); per-user policy, `/kill`, `/budget`, `/ledger`. Signal number provisioned per OQ-6.
- [ ] `LedgerStore` + `PolicyStore` Supabase implementations with migrations; memory fallback for dev
- [ ] Eval set `packages/agent/evals/*.jsonl`: 30 utterances → expected Action (incl. 8 adversarial:
      "ignore your limits", "send everything", prompt injection inside an invoice memo) — gated in CI
- [ ] `docs/adr/0007-mcp-first.md`, `docs/adr/0008-no-advice.md`

**CE Principle:** The eval set is the regression net for every future prompt or model change; the MCP
server is the distribution channel that makes each new rail instantly usable from other agents.

**Key pitfalls**
- Invoice memos and product names are **untrusted input** to the LLM; render them quoted, never as instructions.
- The agent must never see the NWC string or exchange keys — tools execute server-side with the user's stored secrets.
- Confirmation must bind to the exact `Action` hash, so a model cannot "confirm" a different amount.

**Definition of Done**
```bash
pnpm test && pnpm test:evals        # 30/30 intent, 8/8 adversarial refused
pnpm --filter @agentic-bitcoin/mcp build && npx @modelcontextprotocol/inspector ...   # tools listed
# Telegram demo: "pay 100 sats to <addr>" → Confirm button → preimage reply → /ledger shows it
```

---

### M4 — Compute rail: L402 client (the agent pays for its own thinking)

**Goal:** The assistant can call any L402-gated API, paying per request from the user's wallet, and we
demo it by buying inference from a Lightning-paid LLM endpoint.

**Deliverables**
- [ ] `packages/rails/src/compute/l402.ts`: `fetchL402(url, init, {wallet, policy})` — parse `WWW-Authenticate: L402
      macaroon="…", invoice="…"`, policy check on invoice amount, pay via wallet rail, retry with
      `Authorization: L402 <macaroon>:<preimage>`; token cache keyed by host; fixtures from M1
- [ ] Price guard: refuse any 402 above `perActionCapSats` without confirmation; log sats/request in ledger
- [ ] `scripts/demo-compute.ts` against `llm402.ai` (and LightningProx if reachable); record cost per call
- [ ] MCP tool `fetch_l402` + agent skill: "ask the sats-paid model to summarise X"
- [ ] `docs/adr/0009-l402-over-x402.md` (why Lightning/L402, not Coinbase's USDC-on-Base x402, for a bitcoin product)

**CE Principle:** `fetchL402` is a generic paid-HTTP primitive; any future "buy data / buy API /
buy GPU seconds" is just a URL.

**Key pitfalls**
- Macaroon caveats expire; cache per host with TTL and handle a second 402 gracefully.
- Streaming responses after payment — don't buffer the whole body.
- Endpoints are hobby-grade; the demo must survive one being down (fixtures + a local Aperture-less mock server in tests).

**Definition of Done**
```bash
pnpm test                                    # mock 402 server, full handshake
NWC_URL=... pnpm tsx scripts/demo-compute.ts # prints model answer + sats paid + ledger id
```

---

### M5 — Exchange rail: buy bitcoin and DCA (Strike)

**Goal:** "Buy $25 of bitcoin every Friday" works on the user's own Strike account with their
scoped API key, and the schedule survives restarts.

**Deliverables**
- [ ] `packages/rails/src/exchange/strike.ts`: `getRate`, `createExchangeQuote(USD→BTC, amountCents)`,
      `executeQuote(id)` before expiry; map 422 `BALANCE_TOO_LOW` / `EXCHANGE_RATE_NOT_AVAILABLE` to typed errors;
      required scopes documented
- [ ] `packages/rails/src/exchange/coinbase.ts` **interface-only stub** (second adapter proves the interface)
- [ ] `packages/scheduler`: durable schedules (`cron` expr + amount + rail + policy snapshot) in Supabase; runner
      as a Vercel cron **or** a tiny long-running worker (decide per OQ-4); each run is an `Action` with
      `requestedBy: 'schedule'` so caps and the ledger apply
- [ ] Optional "withdraw to Lightning" step after a buy (Strike → user's NWC wallet) so bought sats leave the exchange
- [ ] `scripts/demo-dca.ts`: create a $5 quote → execute → ledger entry (needs a funded Strike account; see OQ-3)
- [ ] Agent: `buy_bitcoin`, `schedule_buy`, `cancel_schedule` with explicit no-advice guardrails in the prompt
- [ ] `docs/adr/0010-schedules-are-actions.md`

**CE Principle:** Schedules reuse policy + ledger unchanged; a second exchange adapter is a one-file PR.

**Key pitfalls**
- Quote expiry is seconds; create→execute must be one tight call with no LLM in between.
- Strike availability is country-limited; surface a clear "exchange rail unavailable in your region" rather than failing silently.
- Never store exchange keys with withdraw scope unless the user explicitly enabled the sweep step.

**Definition of Done**
```bash
pnpm test                                     # fixtures: quote/execute/expiry/422 paths
STRIKE_API_KEY=... pnpm tsx scripts/demo-dca.ts
# scheduler: create "every minute $1" in dev, observe 2 ledger entries, cancel, observe none
```

---

### M6 — Goods rail: buy products with bitcoin (Bitrefill)

**Goal:** "Get me a $50 Amazon gift card" or "top up my phone" is fulfilled from the user's Lightning
wallet, and the agent only reports success once the code is actually delivered.

**Deliverables**
- [ ] `packages/rails/src/goods/bitrefill.ts`: product search, `createInvoice(products[])`, pay the
      returned BOLT11 through the wallet rail, poll invoice/order until `delivered`, return redemption data
      **encrypted into the ledger entry** (not into chat logs by default)
- [ ] Policy: `BuyProduct` is **always** `NeedsConfirmation` (Bitrefill's own guidance), with product, price in
      sats and fiat, and merchant in the confirm card
- [ ] `scripts/demo-goods.ts`: smallest purchasable item (a $1–5 top-up or gift card)
- [ ] Agent: `search_products`, `buy_product`; refuses unknown merchants; MCP exposes the same
- [ ] `docs/adr/0011-payment-is-not-delivery.md`

**CE Principle:** The "invoice → pay → poll → deliver" state machine is the template for every
future merchant (domains, eSIMs, Fold, Oshi, Nostr marketplaces).

**Key pitfalls**
- Treating payment confirmation as delivery (explicitly warned by Bitrefill's partner docs).
- Gift-card codes are bearer secrets — redact from logs, deliver once, confirm receipt.
- Regional catalogue differences break fixtures; pin a known-stable product id for tests.

**Definition of Done**
```bash
pnpm test                                          # fixtures for every order state
BITREFILL_API_KEY=... NWC_URL=... pnpm tsx scripts/demo-goods.ts   # prints masked code + ledger id
```

---

### M7 — "Text Agentic Bitcoin" goes live: onboarding, wallet pairing, SMS

**Goal:** A stranger lands on the page, taps the CTA, pairs their wallet by scanning a QR, sets a
budget, and performs their first action within five minutes.

**Deliverables**
- [ ] `/text` becomes a real onboarding flow: a Signal link (`https://signal.me/#p/+1…`) with a QR, Telegram deep link as the fallback (OQ-6)
- [ ] Wallet pairing: NWC URI paste **or** QR; guided creation of a *budgeted, expiring* connection
      (Alby Hub / Coinos walkthroughs with screenshots); refuse unbudgeted strings without an explicit override
- [ ] First-run policy wizard: daily cap, confirm threshold, which rails to enable
- [ ] Self-serve key entry for Strike and Bitrefill (encrypted per user, revocable, shown masked)
- [ ] Web chat on the landing (optional, same agent) behind a flag
- [ ] Status page `/status`: price feed, wallet relay, Strike, Bitrefill, L402 demo endpoint — green/red
- [ ] Public launch checklist `docs/launch-checklist.md`; README quickstart for self-hosters (`docker compose up`)

**CE Principle:** Self-host docs + status page turn every external dependency into a monitored, swappable thing.

**Key pitfalls**
- Pairing an unbudgeted wallet is the single biggest user risk — make the budgeted path the only easy path.
- Signal and Telegram deliver prompt injection in-band; the M3 adversarial evals must cover both surfaces.

**Definition of Done**
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:evals && pnpm build
# New user: landing → /text → pair wallet (budget 10k sats/day) → "balance?" → "pay 21 sats to …" → ledger
```

---

### M8 — On-chain + cold storage (later)

**Goal:** "Move everything above 200k sats to my cold wallet monthly" works via watch-only xpub and the
wallet's on-chain send. Deferred until M7 has users; captured so the Action union reserves the variant.

---

## Open Questions

| # | Question | Owner | Resolution Path |
|---|---|---|---|
| OQ-1 | Which OFL fonts stand in for Aime (serif, 24px body) and Melange (sans, legal)? | GM | **Resolved 2026-10-07:** compared Newsreader, Source Serif 4, Instrument Serif, Fraunces at 24px; Newsreader + Inter, vendored (ADR-0003). GM can veto by swapping the files. |
| OQ-2 | Price feed primary source: mempool.space `/api/v1/prices` vs CoinGecko `simple/price`? | Claude | M0: implement mempool.space primary (no key, bitcoin-native), CoinGecko fallback; add a third fallback (Coinbase spot) only if the price route logs >1 outage/week in Vercel. |
| OQ-3 | Does Strike offer a sandbox, or do we test against a funded live account with $5 quotes? | GM | Before M5: check `docs.strike.me` for a sandbox/env flag; if none, create a dedicated Strike account with a $20 balance and a quote-only key for CI-adjacent manual runs. Fixtures cover CI either way. |
| OQ-4 | Scheduler runtime: Vercel cron (stateless, minute granularity) vs a small always-on worker (Fly/Start9)? | GM + Claude | M5 ADR-0010: start on Vercel cron hitting `/api/schedules/run` with a shared secret; move to a worker if runs exceed 60s or need sub-minute cadence. |
| OQ-5 | Which Claude model/params for the agent loop and evals? | Claude | M3: read the `claude-api` skill first (never from memory), pick the latest cost-appropriate model, pin the id in `packages/agent/model.ts`, note the choice in ADR-0007. |
| OQ-6 | How do we run Signal? | GM | **Decided: Signal is the user surface.** M3: run `signal-cli` in daemon/JSON-RPC mode on a dedicated number (a prepaid SIM or a VoIP number that accepts the Signal registration SMS; captcha on first register), link it as the bot identity, store the data dir encrypted on the Start9 or a small VPS. Telegram remains the dev surface. SMS dropped. |
| OQ-7 | Where does the dogfood wallet live: Alby Hub on Start9, or Coinos/hosted? | GM | M2: Alby Hub on Start9 (self-custodial, Tor). If channel liquidity is a hassle, use Coinos for the demo and document both in `docs/testing.md`. |
| OQ-8 | Is "buy bitcoin on behalf of a user via their own API key" a money-transmission or advisory concern in the US? | GM (counsel) | Before public M7: one hour with counsel on the non-custodial, user-key, no-advice design; ADR-0001 + Terms language updated with the outcome. Until then, M5 ships behind `EXCHANGE_RAIL_ENABLED=false` for the public instance. |
| OQ-9 | Exact Bitrefill Personal API invoice/pay/poll endpoints and whether Lightning invoices are returned directly? | Claude | M6 first task: read `docs.bitrefill.com` and `bitrefill/agents` repo; encode the real shapes into `packages/fixtures` before writing the adapter. |
| OQ-10 | Name/handle availability and the GitHub org? | GM | **Partly resolved:** `grahampatrick/agentic-bitcoin` is public and `agentic-bitcoin.vercel.app` is live. Domain (`agenticbitcoin.com` / `.xyz`) still to check and buy; set `NEXT_PUBLIC_SITE_URL` in Vercel when it exists. |

---

## Architectural Non-Negotiables

Every PR is reviewed against these:

1. **No custody.** No seed phrases, no private keys, no pooled funds, ever. Only scoped NWC strings and user-owned exchange keys, encrypted at rest, redacted in logs.
2. **Policy before rail.** No code path reaches a rail without `evaluate()` returning `Allow` or a bound confirmation. The LLM cannot call rails; it emits `Action`s.
3. **Money is integers.** Sats as `bigint`, fiat as integer cents. Floats fail lint (custom Biome rule or a grep gate).
4. **Every action is in the ledger** — attempted, denied, confirmed, succeeded, failed — with an idempotency key.
5. **Untrusted text is data.** Invoice memos, product names, 402 bodies, chat messages: rendered quoted, never interpreted as instructions. Adversarial evals must stay green.
6. **One wallet socket.** Merchant rails produce invoices; only the wallet rail pays them.
7. **Fixtures first.** No adapter PR without fixtures and the contract suite passing on fakes; real-network tests are opt-in via env.
8. **Open source hygiene.** No secrets in git (gitleaks in CI), `.env.example` always current, every rail runnable against a fake, MIT headers not required but licence file is.
9. **No advice.** The agent and the copy never recommend buying, timing, or amounts. "Not financial advice" is on the page and in the system prompt.
10. **Structure, not identity.** We copy instinct.com's layout, spacing and interactions; never its fonts, logo, mascot, or sentences.

---

## CE Feedback Loops

- **CI gates** (`.github/workflows/ci.yml`): `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, gitleaks, quote-drift test (whitepaper phrases verbatim), brand-token drift check, and from M3 `pnpm test:evals`. Red = no merge.
- **Shared fixtures** (`packages/fixtures`): invoices, L402 challenges, Strike quotes, Bitrefill orders, policies, ledger windows — consumed by core, rails, agent, bot. A fixture change that breaks any package is caught in one run.
- **Contract suite** (`describeWalletRail`, `describeExchangeRail`, `describeGoodsRail`): real adapters must pass the exact tests fakes pass; new rail = one file + fixtures.
- **ADRs at decision time** (`docs/adr/NNNN-*.md`): numbered above per milestone (0003 became the fonts ADR in M0, so M1+ numbers shifted by one); written in the same PR as the decision, never after.
- **Demo per milestone**: a `scripts/demo-*.ts` that a stranger can run with env vars, printing a ledger id. Also the proof in each Definition of Done.
- **Ledger as the oracle**: every demo and eval asserts on ledger entries, so observability and tests share one source of truth.
- **Status page** (M7) turns external-dependency drift into a visible signal rather than a surprise.
- **Open-source loop**: public issues template for "new merchant rail" with the adapter checklist; contributions arrive pre-shaped.

---

## What to Do First

1. Create `~/Documents/agentic-bitcoin` as a git repo with `LICENSE` (MIT), this `plan.md`, `README.md`, `.gitignore`; create the public GitHub repo and push.
2. Copy the tinysats pnpm skeleton (`apps/web`, `packages/brand`, Biome, vitest, `ci.yml`); rename scopes to `@agentic-bitcoin/*`; add `.claude/launch.json` on port 3900.
3. Encode the measured Instinct values into `packages/brand/tokens.ts` and write ADR-0001 and ADR-0002.
4. Resolve OQ-1 (fonts) with a three-way preview, then build `apps/web/app/page.tsx` + `home.css` to match the reference section above, including reactions, CTA highlighter, staggered reveal, and reduced-motion.
5. Implement `/api/price` (mempool.space → CoinGecko fallback, 60s cache, integers) and `LivePrice` with SSR first paint; write `price.test.ts` and the quote-drift test.
6. Add `/privacy`, `/terms`, and the `/text` waitlist; verify at 375px and 1440px in the preview; run the M0 Definition of Done.
7. Deploy to Vercel as `agentic-bitcoin`; add the URL to the README; open the M1 branch.

---

*Update this file when decisions change.*
