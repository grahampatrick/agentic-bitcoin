# Launch checklist (M7)

Everything below must be true before the Signal number goes on the landing page.

## Credentials and live verification (owner)
- [ ] NWC string from a budgeted Alby Hub connection; `pnpm --filter @agentic-bitcoin/rails test:wallet` green
- [ ] `demo:pay`, `demo:compute`, `demo:dca` ($5), `demo:goods` ($5) each run once; results pasted into this file
- [x] `ANTHROPIC_API_KEY` set; evals 32/32 intent, 8/8 adversarial on 2026-10-09 (CI, Opus 5.5, medium effort)
- [x] GitHub secret `ANTHROPIC_API_KEY` set; `evals` CI job live
- [ ] Counsel hour on the non-custodial / no-advice design done (plan OQ-8); exchange rail stays off publicly until then

## Infrastructure
- [ ] Vercel env for the receive side (M10): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SECRETS_KEY` (same key as the bot), `NEXT_PUBLIC_SITE_URL`
- [ ] Supabase project: migrations 0001–0007 applied; `SUPABASE_URL` + service-role key in the bot env and Vercel
- [ ] `SECRETS_KEY` generated (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), stored only in the bot env and a password manager
- [ ] signal-cli daemon registered on the dedicated number per docs/signal.md (OQ-6); data dir backed up; survives reboot; `/api/v1/check` answers
- [ ] Bot deployed (`docker compose up -d`), restarts on failure, logs shipped somewhere; scheduler ticks once a minute
- [x] Vercel env `ANTHROPIC_API_KEY` (live model on /demo, 2026-10-09)
- [ ] Vercel env: `NEXT_PUBLIC_SIGNAL_NUMBER` (and/or `NEXT_PUBLIC_TELEGRAM_BOT`), `NEXT_PUBLIC_SITE_URL`
- [ ] Anthropic credit: $5 added 2026-10-09; top up before sharing /demo widely (each visitor turn spends credit)
- [ ] `/status` all green for 24 h

## Product
- [ ] New-user path timed: landing → /text → `/start` wizard → `/pair` → balance → 21-sat payment → `/ledger`, under five minutes
- [ ] Unbudgeted string refused in a real wallet test; override path works and warns
- [ ] `/kill` tested mid-conversation; `/key strike remove` tested
- [ ] Prompt-injection spot check over Signal: an invoice memo with instructions, a product name with instructions
- [ ] Privacy + Terms re-read against what the bot actually stores (policy, ledger, sealed secrets, trimmed history)
- [ ] Domain bought and `NEXT_PUBLIC_SITE_URL` updated (OQ-10)

## After launch
- [ ] Watch the ledger for `UNKNOWN_STATE` entries daily for the first week; resolve by hand
- [ ] Rotate `SECRETS_KEY` procedure written down (re-encrypt rows)
