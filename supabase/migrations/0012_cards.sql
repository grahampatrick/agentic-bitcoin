-- Anvard M17a: virtual Lightning cards. A row is a POLICY (scope + monthly cap) on the user's own
-- wallet, never a balance. spent_sats/period_start are a display snapshot; the ledger is the truth.
create table if not exists public.virtual_cards (
  id text primary key,
  user_id text not null,
  name text not null,
  scope text[] not null,
  monthly_cap_sats bigint not null check (monthly_cap_sats > 0),
  per_action_cap_sats bigint,
  confirm_above_sats bigint,
  reset_day int not null default 1 check (reset_day between 1 and 28),
  state text not null default 'active' check (state in ('active','paused','closed')),
  created_at timestamptz not null default now(),
  view_token_hash text,
  spent_sats bigint,
  period_start timestamptz
);
create index if not exists virtual_cards_user on public.virtual_cards (user_id, created_at);
alter table public.virtual_cards enable row level security;
