-- Anvard M16: trading-card fields on products, remote shops speaking the commerce protocol.
alter table public.shop_products add column if not exists tcg_json text;
alter table public.recipients add column if not exists manifest_host text;
create index if not exists shop_products_tcg on public.shop_products (category) where category = 'tcg';
