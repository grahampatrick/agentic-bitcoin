-- Agentic Bitcoin / Anvard M15: Lightning addresses for paired users. A row is a pointer to the
-- user's own wallet (sealed NWC) or a forward; never a balance.
create table if not exists public.lightning_addresses (
  name text primary key check (name ~ '^[a-z0-9][a-z0-9._-]{1,31}$'),
  user_id text not null unique,
  nwc_sealed text,
  forward_to text,
  created_at timestamptz not null default now()
);
alter table public.lightning_addresses enable row level security;

-- receive_invoices now also records invoices minted for addresses (slug 'addr:<name>'): drop the recipients FK
alter table public.receive_invoices drop constraint if exists receive_invoices_slug_fkey;
