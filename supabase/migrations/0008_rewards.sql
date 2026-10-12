-- Agentic Bitcoin M13: sats-back rewards. A reward is OUR liability until paid (a Lightning payment
-- with a hash); never a user balance. One reward per order.
create table if not exists public.rewards (
  id text primary key,
  user_id text,
  payout_address text,
  source text not null check (source in ('directory','bitrefill')),
  merchant_slug text,
  order_id text not null unique,
  purchase_sats text not null,
  amount_sats text not null,
  bps integer not null,
  state text not null check (state in ('pending','payable','paid','void')),
  created_at timestamptz not null default now(),
  payable_at timestamptz not null,
  paid_at timestamptz,
  payment_hash text,
  void_reason text
);
create index if not exists rewards_user on public.rewards (user_id);
create index if not exists rewards_open on public.rewards (state) where state in ('pending','payable');
alter table public.rewards enable row level security;

alter table public.shop_orders add column if not exists reward_address text;
