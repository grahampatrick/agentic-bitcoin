-- Anvard M22: referral rewards in sats. A user has one invite code; a friend has at most one
-- referral, made before their first payment. Qualifying is read from the friend's ledger; the two
-- flat rewards are ordinary rows in public.rewards (source 'referral', order_id 'ref:<id>:<side>'),
-- paid by the same payout run as sats-back from the operator's wallet (ADR-0017, ADR-0025).
create table if not exists public.referral_codes (
  code text primary key,
  user_id text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  id text primary key,
  code text not null references public.referral_codes (code),
  referrer_id text not null,
  friend_id text not null unique,
  joined_at timestamptz not null,
  qualified_at timestamptz,
  qualifying_entry_id text,
  qualifying_sats text,
  reward_ids text[] not null default '{}',
  referrer_skipped text
);
create index if not exists referrals_referrer on public.referrals (referrer_id);
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;

alter table public.rewards drop constraint if exists rewards_source_check;
alter table public.rewards add constraint rewards_source_check
  check (source in ('directory','bitrefill','referral'));
