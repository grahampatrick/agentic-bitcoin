# @agentic-bitcoin/bot

One `ChatSurface` interface, two adapters: **Telegram** (grammY, inline Confirm/Cancel buttons)
for development, **Signal** (`signal-cli` JSON-RPC daemon; "yes"/"no" replies) for users.

```bash
# Telegram (dev)
TELEGRAM_BOT_TOKEN=… ANTHROPIC_API_KEY=… NWC_URL=… pnpm --filter @agentic-bitcoin/bot start
# Signal
signal-cli -a +15551234567 daemon --http localhost:8080     # separate process
SURFACE=signal SIGNAL_ACCOUNT=+15551234567 ANTHROPIC_API_KEY=… NWC_URL=… pnpm --filter @agentic-bitcoin/bot start
```

People talk to it in plain words; there are no commands to learn ([docs/bot.md](../../docs/bot.md),
ADR-0029). Four things are handled in code and never reach the model: a pasted secret (stored and
redacted), "stop everything" (the kill switch), a yes or a no (bound to the action's hash), and the
invite code at first contact. Views and settings are the `show` and `change_setting` tools, served
by `src/desk.ts`: `planSetting` validates a change and returns a `commit`; a change that narrows
applies at once, one that widens waits for the person's own yes. The old slash commands remain as
aliases over the same code.

Stores: in memory by default; set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and apply
`supabase/migrations/0002_agent.sql` for durable ledger, policy, secrets and history.
`SECRETS_KEY` (32 bytes) encrypts per-user wallet strings; until M7 pairing, `NWC_URL` is the
single dev wallet and without it the FAKE wallet runs.
