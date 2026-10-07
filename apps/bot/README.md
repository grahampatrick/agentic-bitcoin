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

Commands (never go through the model): `/budget [daily|action|confirm <sats> | allow|deny <dest> |
rail <name> on|off]`, `/kill`, `/resume`, `/ledger`, `/help`.

Stores: in memory by default; set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and apply
`supabase/migrations/0002_agent.sql` for durable ledger, policy, secrets and history.
`SECRETS_KEY` (32 bytes) encrypts per-user wallet strings; until M7 pairing, `NWC_URL` is the
single dev wallet and without it the FAKE wallet runs.
