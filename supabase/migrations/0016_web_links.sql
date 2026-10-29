-- Anvard M23: the workspace. A web link is a long random token the bot hands a user in chat
-- (`/web`); only its hash is kept, with an expiry. Presenting the token opens /me, a window onto
-- the user's own rows (policy, cards, address, referrals, rewards). `/web revoke` or "Log out
-- everywhere" deletes every row for the user (ADR-0027).
create table if not exists public.web_links (
  token_hash text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists web_links_user on public.web_links (user_id);
alter table public.web_links enable row level security;
