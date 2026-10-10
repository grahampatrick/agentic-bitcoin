-- Agentic Bitcoin M12: the storefront. Prices in integer cents as text; orders hold a payment hash
-- and SEALED shipping/contact blobs (AES-256-GCM, SECRETS_KEY) — never plaintext, never money.
create table if not exists public.shop_products (
  merchant_slug text not null references public.recipients(slug) on delete cascade,
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  title text not null,
  description text,
  image_url text,
  category text not null,
  price_cents text not null,
  deal_cents text,
  kind text not null check (kind in ('digital','physical')),
  in_stock boolean not null default true,
  ships_to text[],
  updated_at timestamptz not null default now(),
  primary key (merchant_slug, id)
);
create index if not exists shop_products_category on public.shop_products (category) where in_stock;

create table if not exists public.shop_orders (
  id text primary key,
  merchant_slug text not null references public.recipients(slug),
  items text not null,
  total_cents text not null,
  total_sats text not null,
  usd_cents_per_btc text not null,
  bolt11 text not null,
  payment_hash text not null unique,
  state text not null check (state in ('unpaid','paid','fulfilled','cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  preimage text,
  shipping_sealed text,
  contact_sealed text,
  buyer_key text,
  note text
);
create index if not exists shop_orders_merchant on public.shop_orders (merchant_slug, created_at desc);
create index if not exists shop_orders_buyer on public.shop_orders (buyer_key);
alter table public.shop_products enable row level security;
alter table public.shop_orders enable row level security;
