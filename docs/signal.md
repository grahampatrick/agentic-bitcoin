# Signal: the user surface

The bot talks to Signal through **signal-cli** running as a daemon with an HTTP JSON-RPC interface
(`signal-cli-jsonrpc(5)`). The daemon holds the bot's own Signal identity; the bot process only
speaks HTTP to it. Verified against signal-cli 0.14.9 on 2026-10-08.

## 1. A phone number for the bot

Signal registration needs a number that can receive an SMS (or, after one SMS attempt, a voice
call). Options, best first:
- a **prepaid SIM** in an old phone, kept only for this (most reliable; keep the SIM, Signal may
  re-verify);
- a **VoIP number** that accepts SMS from short codes (many do not; Google Voice usually does not
  for Signal; some Twilio numbers do, then use `--voice`);
- **not** your personal number: registering it with signal-cli unlinks your phone.

## 2. Install and register (once, on the machine that will run the daemon)

```bash
brew install signal-cli                       # macOS; Linux: release tarball or the Docker image in docker-compose.yml
export SIGNAL_ACCOUNT=+15551234567            # E.164
# captcha: open https://signalcaptchas.org/registration/generate.html on this machine, solve it,
# right-click "Open Signal" → copy link; it starts with signalcaptcha://
signal-cli -a "$SIGNAL_ACCOUNT" register --captcha signalcaptcha://signal-recaptcha-v2.…
# if no SMS arrives after a minute:  signal-cli -a "$SIGNAL_ACCOUNT" register --voice --captcha signalcaptcha://…
signal-cli -a "$SIGNAL_ACCOUNT" verify 123456  # the 6-digit code
signal-cli -a "$SIGNAL_ACCOUNT" updateProfile --given-name "Agentic Bitcoin"
signal-cli -a "$SIGNAL_ACCOUNT" send -m "hello from the bot" +1YOURPHONE   # sanity check
```

"Invalid captcha" means the token expired (they live about a minute): generate a new one. HTTP 429
means too many attempts: wait an hour.

## 3. Run the daemon

```bash
signal-cli -a "$SIGNAL_ACCOUNT" daemon --http localhost:8080 --no-receive-stdout
```

Endpoints the bot uses: `GET /api/v1/check` (health), `GET /api/v1/events` (SSE stream of
`{"method":"receive","params":{"envelope":…}}` notifications), `POST /api/v1/rpc` (`send`).
Single-account mode (`-a`) needs no `account` param; set `SIGNAL_MULTI_ACCOUNT=1` only if you run
the daemon without `-a`.

The daemon has no authentication and **pins the Host header to localhost**: keep it bound to
localhost and never expose the port. (Verified: `curl -H 'Host: other' …` is refused.)

Keep it running: on macOS a `launchd` plist, on Linux a systemd unit, or `docker compose up -d`
(the compose file includes a signal-cli container; register inside it with
`docker compose run --rm signal signal-cli -a $SIGNAL_ACCOUNT register --captcha …`). Back up
`~/.local/share/signal-cli` (or the compose volume): it is the bot's identity.

## 4. Point the bot at it

```bash
SURFACE=signal SIGNAL_ACCOUNT=+15551234567 SIGNAL_DAEMON_URL=http://localhost:8080 \
ANTHROPIC_API_KEY=… SECRETS_KEY=… pnpm --filter @agentic-bitcoin/bot start
```

The bot refuses to start if `/api/v1/check` does not answer. Then, from your phone: message the
number, `/start`, `/pair …`.

## What Signal cannot do (and how the bot compensates)
- **No buttons.** Confirmations are plain `yes` / `no` replies bound to the latest pending action.
- **No deleting your messages.** After `/pair` or `/key`, delete the message yourself (the bot
  reminds you); on Telegram the bot deletes it.
- **Prompt injection arrives in-band** like any chat. Commands never reach the model; secrets are
  intercepted; the adversarial evals cover the rest.
