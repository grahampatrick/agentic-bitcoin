-- Agentic Bitcoin M9: giving. Recipients are names + Lightning addresses, never balances.
create table if not exists public.recipients (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind text not null check (kind in ('church','missionary','creator','merchant')),
  name text not null,
  lightning_address text not null,
  verified_how text check (verified_how in ('domain','operator')),
  verified_at timestamptz,
  website text,
  country text,
  description text,
  -- null = directory entry (visible to everyone once verified); set = private to that user
  owner_user_id text,
  updated_at timestamptz not null default now()
);
create index if not exists recipients_owner on public.recipients (owner_user_id);
alter table public.recipients enable row level security;
-- Written only by the server with the service-role key; the web directory reads verified rows with owner_user_id null.

-- A schedule is a recurring buy, sweep, OR gift.
alter table public.schedules drop constraint if exists schedules_kind_check;
alter table public.schedules add constraint schedules_kind_check check (kind in ('buy','sweep','give'));
alter table public.schedules add column if not exists recipient_slug text;
alter table public.schedules add column if not exists recipient_name text;
alter table public.schedules add column if not exists purpose text;
alter table public.schedules add column if not exists verified boolean;
