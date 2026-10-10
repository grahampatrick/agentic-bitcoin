-- Agentic Bitcoin M11: campaigns. Progress is computed from contributions (deduped by payment hash)
-- and pledges; nothing here is a balance.
create table if not exists public.campaigns (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  recipient_slug text not null references public.recipients(slug) on delete cascade,
  title text not null,
  story text,
  goal_usd_cents_per_month text,
  goal_sats_total text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  check ((goal_usd_cents_per_month is null) <> (goal_sats_total is null))
);
create index if not exists campaigns_recipient on public.campaigns (recipient_slug);

create table if not exists public.campaign_updates (
  id text primary key,
  campaign_slug text not null references public.campaigns(slug) on delete cascade,
  at timestamptz not null default now(),
  text text not null
);
create index if not exists campaign_updates_slug_at on public.campaign_updates (campaign_slug, at desc);

create table if not exists public.campaign_contributions (
  id bigserial primary key,
  campaign_slug text not null references public.campaigns(slug) on delete cascade,
  payment_hash text,
  amount_msats text not null,
  at timestamptz not null,
  source text not null check (source in ('chat','web','reported')),
  supporter_key text,
  supporter_name text
);
create unique index if not exists campaign_contributions_hash on public.campaign_contributions (payment_hash) where payment_hash is not null;
create index if not exists campaign_contributions_slug on public.campaign_contributions (campaign_slug);

create table if not exists public.campaign_pledges (
  schedule_id text primary key,
  campaign_slug text not null references public.campaigns(slug) on delete cascade,
  supporter_key text not null,
  amount_sats text not null,
  usd_cents text,
  cron text not null,
  active boolean not null default true
);
create index if not exists campaign_pledges_slug on public.campaign_pledges (campaign_slug);

create table if not exists public.campaign_followers (
  campaign_slug text not null references public.campaigns(slug) on delete cascade,
  user_id text not null,
  delivered_at timestamptz,
  primary key (campaign_slug, user_id)
);

-- web gifts made from a campaign page carry the campaign so settled invoices count toward it
alter table public.receive_invoices add column if not exists campaign_slug text;
alter table public.schedules add column if not exists campaign_slug text;
alter table public.schedules add column if not exists supporter_name text;

alter table public.campaigns enable row level security;
alter table public.campaign_updates enable row level security;
alter table public.campaign_contributions enable row level security;
alter table public.campaign_pledges enable row level security;
alter table public.campaign_followers enable row level security;
