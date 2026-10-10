-- Agentic Bitcoin M10: the receive side. Invoices are minted by the recipient's wallet; we keep
-- only hashes and amounts so a recipient can see what arrived. nwc_receive is an AES-256-GCM blob
-- (SECRETS_KEY), never plaintext.
alter table public.recipients add column if not exists nwc_receive text;
alter table public.recipients add column if not exists dashboard_token_hash text;
alter table public.recipients add column if not exists contact text;
alter table public.recipients add column if not exists submitted_at timestamptz;

create table if not exists public.receive_invoices (
  payment_hash text primary key,
  slug text not null references public.recipients(slug) on delete cascade,
  amount_msats text not null,
  comment text,
  source text not null check (source in ('proxy','nwc')),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  preimage text
);
create index if not exists receive_invoices_slug_created on public.receive_invoices (slug, created_at desc);
alter table public.receive_invoices enable row level security;
