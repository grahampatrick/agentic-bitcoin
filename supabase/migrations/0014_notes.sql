-- Anvard M21: private transaction notes. A note is a ledger event (type 'noted') on the payment it
-- belongs to; its payload holds {sealed} (AES-256-GCM with SECRETS_KEY) or, on servers without a
-- key, {note}. An event with neither clears the note. Notes never enter the stored action.
alter table public.ledger_events drop constraint if exists ledger_events_type_check;
alter table public.ledger_events add constraint ledger_events_type_check
  check (type in ('requested','started','succeeded','failed','noted'));
