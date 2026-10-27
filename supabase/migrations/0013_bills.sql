-- Anvard M20: pay bills with bitcoin. A bill is a schedule (kind 'bill') that pays a Lightning
-- address on a cron, in dollars re-priced at pay time or fixed sats; bill_json holds
-- {name, mode: auto|ask, memo}. Ask-mode bills park for the user's yes instead of paying.
alter table public.schedules drop constraint if exists schedules_kind_check;
alter table public.schedules add constraint schedules_kind_check check (kind in ('buy','sweep','give','invoice','bill'));
alter table public.schedules add column if not exists bill_json text;
