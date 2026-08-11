#!/usr/bin/env bash
# REPARSEO P0.9 — runner AISLADO (PostgreSQL efímero, sin red).
#  - Aplica la cadena REAL de migraciones pendientes: P0.5 -> P0.6 -> P0.8 -> P0.9.
#  - service_role es un rol dedicado NO superusuario sin acceso directo a tablas.
#  - Corre la integración real: handler -> claim -> parser -> plan -> RPC.
#  - Sin PostgreSQL local: SKIP EXPLÍCITO (exit 3). Un SKIP NUNCA es PASS.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! command -v initdb >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo "SKIP / NO VERIFICADO: no hay PostgreSQL local (initdb/psql)." >&2
  exit 3
fi

AS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="${P09_LOCAL_USER:-pgtest}"
  if ! id "$RUNAS" >/dev/null 2>&1 || ! command -v setpriv >/dev/null 2>&1; then
    echo "SKIP / NO VERIFICADO: define P09_LOCAL_USER con un usuario local sin privilegios." >&2
    exit 3
  fi
  AS="setpriv --reuid=$(id -u "$RUNAS") --regid=$(id -g "$RUNAS") --clear-groups env HOME=/tmp"
fi

TMP="$(mktemp -d /tmp/p09cluster.XXXXXX)"
DATA="$TMP/data"; SOCK="$TMP/sock"; mkdir -p "$SOCK"; chmod 777 "$TMP" "$SOCK"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSSLMODE || true
cleanup() { $AS pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== initdb (efímero, sin red) =="
$AS initdb -D "$DATA" -U p09owner --auth=trust >"$TMP/initdb.log" 2>&1
$AS pg_ctl -D "$DATA" -o "-k $SOCK -c listen_addresses=''" -l "$TMP/pg.log" start >/dev/null
export PGHOST="$SOCK" PGUSER=p09owner PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE p09;"
export PGDATABASE=p09
psql -v ON_ERROR_STOP=1 -q -c "CREATE ROLE service_role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"

echo "== esquema + cadena REAL de migraciones (P0.5, P0.6, P0.8, P0.9) =="
MIGS=(
  supabase/pending_migrations/20260812210000_reparse_state_and_apply_plan.sql
  supabase/pending_migrations/20260814000000_reparse_claim_token_p05.sql
  supabase/pending_migrations/20260815120000_reparse_lease_p06.sql
  supabase/migrations/20260811085231_03499c01-d84f-47d6-9296-88fac9cb208f.sql
  supabase/pending_migrations/20260816000000_reparse_p08_precision_and_completeness.sql
  supabase/pending_migrations/20260818000000_reparse_p09_reemplazo_registral.sql
  supabase/pending_migrations/20260819000000_reparse_p10_exact_set.sql
)
psql -v ON_ERROR_STOP=1 -q -f supabase/tests/reparse_p05_shim.sql
psql -v ON_ERROR_STOP=1 -q -f supabase/tests/reparse_p09_shim.sql
for m in "${MIGS[@]}"; do psql -v ON_ERROR_STOP=1 -q -f "$m"; done
psql -v ON_ERROR_STOP=1 -q -f supabase/tests/reparse_p09_grants.sql
echo "   manifiesto:"; sha256sum "${MIGS[@]}" supabase/tests/reparse_p09_shim.sql supabase/tests/reparse_p09_grants.sql

echo "== integración real (handler + parser + plan + RPC, todo como worker) =="
P09_LIVE=1 P09_PGHOST="$SOCK" P09_PGDATABASE=p09 P09_PGUSER=service_role P09_PGOWNER=p09owner \
  bunx vitest run --fileParallelism=false src/test/reparseP09Live.test.ts

echo "PASS · P0.9 verificado contra PostgreSQL efímero real"
