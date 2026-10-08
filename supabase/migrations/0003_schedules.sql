-- Agentic Bitcoin M5: recurring buys. Money as decimal strings, never JSON numbers.
create table if not exists public.schedules (
  id text primary key,
  user_id text not null,
  exchange text not null check (exchange in ('strike','coinbase')),
  usd_cents text not null,
  cron text not null,
  estimated_sats text not null,
  sweep_to_wallet boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_run_at text
);
create index if not exists schedules_active on public.schedules (active) where active;
create index if not exists schedules_user on public.schedules (user_id);
alter table public.schedules enable row level security;
-- Written only by the server with the service-role key; no public policies.

-- M8: a schedule is a recurring buy OR a recurring sweep to cold storage.
alter table public.schedules add column if not exists kind text not null default 'buy' check (kind in ('buy','sweep'));
alter table public.schedules add column if not exists address text;
alter table public.schedules add column if not exists keep_sats text;
alter table public.schedules add column if not exists max_sats text;
