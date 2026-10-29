#!/usr/bin/env bash
# Apply supabase/migrations/*.sql in order to the database in $DATABASE_URL (one transaction).
# Every migration is idempotent, so re-running is safe.
#
#   DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' scripts/migrate.sh
#
# Supabase → Project → Connect → "Session pooler" (IPv4) string. Never commit or paste it anywhere else.
set -euo pipefail
cd "$(dirname "$0")/.."
# Fallback: a DATABASE_URL= line in apps/bot/.env (gitignored), so the string never has to be typed.
if [ -z "${DATABASE_URL:-}" ] && [ -f apps/bot/.env ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/bot/.env | head -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//")"
fi
: "${DATABASE_URL:?set DATABASE_URL (env or a DATABASE_URL= line in apps/bot/.env) to the Supabase session-pooler string}"
command -v psql >/dev/null || { echo "psql not found (brew install libpq && brew link --force libpq)"; exit 1; }

{
  echo "begin;"
  for f in supabase/migrations/*.sql; do
    echo "\\echo applying $(basename "$f")"
    cat "$f"
    echo
  done
  echo "commit;"
} | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q

echo
echo "tables now in public:"
psql "$DATABASE_URL" -At -c "select string_agg(tablename, ', ' order by tablename) from pg_tables where schemaname='public'"
