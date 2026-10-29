# The workspace (`/me`)

Your account on the web: what your Anvard may do, what it is connected to, who you invited, and
the few things you can change without a command. Chat is the key (ADR-0027): there is no password.

## Getting in

- In chat, send `/web` (or `/account`). The reply is a private link that works for 30 days from any
  browser. Keep it private: anyone with the link sees what you see.
- `/web` again gives another link; `/web revoke` cuts every link off. "Log out" on the site revokes
  the link you are using; "Log out everywhere" revokes all of them.
- No database on the server? `/me?t=demo` opens a fictional account so you can see the shape.

## Pages

- **Workspace**: invites rewarded this month out of the monthly limit, your invite link and code,
  a share button; what your Anvard is allowed to do right now; ways to reach Anvard.
- **Vault**: whether a wallet is paired (never the connection string), your Lightning address,
  your cards (pause and resume here), cold-storage addresses, whether Strike and Bitrefill keys are
  set.
- **Trusted people**: the allow list (when it has entries, only those can receive), the block list,
  friends who joined with your code, and whether the kill switch is on.
- **Preferences**: your chat identity, active web links, limits (daily cap, per action, confirm
  above), rails on or off, the kill switch, replace-what-you-spend (read-only).
- **Connectors**: the rails and keys as a checklist, each pointing at the chat command that sets it.
- **Invite a friend**: the referral terms, link, code and tally.

## What the web cannot do, on purpose

Pair a wallet, enter a key, register a cold-storage address, or change replace-what-you-spend.
Those involve secrets or amounts the chat confirmation flow owns; the page tells you the command.

## Operator setup

- `SITE_URL` on the bot (the link's host) and `WEB_LINK_TTL_DAYS` (default 30).
- Supabase: migration `0016_web_links.sql`; the web needs `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` like the rest of the site. The web never needs `SECRETS_KEY`.
- Contact rows: `NEXT_PUBLIC_SIGNAL_NUMBER`, `NEXT_PUBLIC_DISCORD_INVITE`, `NEXT_PUBLIC_CONTACT_EMAIL`.
- The invite terms come from the same `REFERRAL_*` values as the bot.
