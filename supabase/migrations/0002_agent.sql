-- Agentic Bitcoin M3: per-user ledger, policy, secrets, chat history.
-- All money inside payload/policy is stored as decimal strings ("123n"), never JSON numbers.

create table if not exists public.ledger_events (
  seq bigserial primary key,
  user_id text not null,
  action_id text not null,
  type text not null check (type in ('requested','started','succeeded','failed')),
  at timestamptz not null,
  payload text not null
);
create index if not exists ledger_events_user_at on public.ledger_events (user_id, at);

create table if not exists public.policies (
  user_id text primary key,
  policy text not null,
  updated_at timestamptz not null default now()
);

-- Encrypted blobs only (AES-256-GCM, key in SECRETS_KEY, never in the database).
create table if not exists public.user_secrets (
  user_id text not null,
  name text not null check (name in ('nwc','strike','bitrefill')),
  blob text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);

create table if not exists public.chat_history (
  user_id text primary key,
  history text not null,
  updated_at timestamptz not null default now()
);

alter table public.ledger_events enable row level security;
alter table public.policies enable row level security;
alter table public.user_secrets enable row level security;
alter table public.chat_history enable row level security;
-- Written only by the server with the service-role key; no public policies.
