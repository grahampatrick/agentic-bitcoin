-- Agentic Bitcoin waitlist (M0). Apply in the Supabase SQL editor or via `supabase db push`.
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  contact text unique not null,
  kind text not null check (kind in ('email', 'npub')),
  source text not null default 'landing' check (source in ('landing', 'text', 'unknown')),
  created_at timestamptz not null default now()
);
-- Written only by the server route with the service-role key. RLS on, no public policies.
alter table public.waitlist enable row level security;
comment on table public.waitlist is 'M0 landing waitlist. Written only by the server route via service-role key.';
