-- Anvard M24: the shop plan. Dates only; the money is an ordinary row in `invoices`, issued by the
-- operator's own recipient to the merchant and paid at /pay/<token>. `applied_invoice_ids` keeps a
-- paid invoice from extending the plan twice (ADR-0028).
create table if not exists public.merchant_plans (
  slug text primary key,
  started_at timestamptz not null,
  pilot_ends_at timestamptz not null,
  paid_through_at timestamptz,
  open_invoice_id text,
  applied_invoice_ids text not null default '[]',
  updated_at timestamptz not null default now()
);
alter table public.merchant_plans enable row level security;
