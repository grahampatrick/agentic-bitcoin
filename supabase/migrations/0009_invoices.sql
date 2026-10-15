-- Agentic Bitcoin M14: issued invoices and payment requests. The BOLT11 is minted by the issuer's
-- wallet; our row is a pointer with a hash. Payer contact is a sealed blob.
create table if not exists public.invoices (
  id text primary key,
  number text not null,
  issuer text not null,
  issuer_name text,
  kind text not null check (kind in ('invoice','request')),
  payer_name text not null,
  payer_contact_sealed text,
  items text not null,
  total_cents text not null,
  memo text,
  due_at timestamptz,
  state text not null check (state in ('open','paid','void')),
  token text not null unique,
  bolt11 text,
  payment_hash text unique,
  amount_sats text,
  usd_cents_per_btc text,
  minted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  preimage text,
  paid_reported boolean,
  voided_at timestamptz
);
create index if not exists invoices_issuer on public.invoices (issuer, created_at desc);
create index if not exists invoices_open on public.invoices (state) where state = 'open';
alter table public.invoices enable row level security;

-- recurring invoices are schedules
alter table public.schedules drop constraint if exists schedules_kind_check;
alter table public.schedules add constraint schedules_kind_check check (kind in ('buy','sweep','give','invoice'));
alter table public.schedules add column if not exists invoice_json text;
