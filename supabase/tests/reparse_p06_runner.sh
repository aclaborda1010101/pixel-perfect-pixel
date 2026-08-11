#!/usr/bin/env bash
# REPARSEO P0.6 — runner AISLADO y AUTOMATIZADO (puerta de CI).
#  - Cluster PostgreSQL efímero (initdb), sin red, socket unix privado.
#  - OWNER: sólo crea esquema/fixtures. WORKER (service_role): rol dedicado
#    no-superusuario SIN acceso directo a tablas; ejecuta TODAS las RPC.
#  - Aplica las migraciones PENDIENTES REALES (P0.5 + P0.6) y corre la suite
#    de integración que usa el handler y processNotaWithClaim de producción.
#  - Si no hay PostgreSQL local: SKIP EXPLÍCITO (exit 3). Nunca declara GO.
set -euo pipefail
cd "$(dirname "$0")/../.."

if ! command -v initdb >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo "SKIP / NO VERIFICADO: no hay PostgreSQL local (initdb/psql)." >&2
  exit 3
fi

AS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="${P06_LOCAL_USER:-pgtest}"
  if ! id "$RUNAS" >/dev/null 2>&1 || ! command -v setpriv >/dev/null 2>&1; then
    echo "SKIP / NO VERIFICADO: define P06_LOCAL_USER con un usuario local sin privilegios." >&2
    exit 3
  fi
  AS="setpriv --reuid=$(id -u "$RUNAS") --regid=$(id -g "$RUNAS") --clear-groups env HOME=/tmp"
fi

TMP="$(mktemp -d /tmp/p06cluster.XXXXXX)"
DATA="$TMP/data"; SOCK="$TMP/sock"; mkdir -p "$SOCK"; chmod 777 "$TMP" "$SOCK"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSSLMODE || true
cleanup() { $AS pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== initdb (efímero, sin red) =="
$AS initdb -D "$DATA" -U p06owner --auth=trust >"$TMP/initdb.log" 2>&1
$AS pg_ctl -D "$DATA" -o "-k $SOCK -c listen_addresses=''" -l "$TMP/pg.log" start >/dev/null
export PGHOST="$SOCK" PGUSER=p06owner PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE p06;"
export PGDATABASE=p06
psql -v ON_ERROR_STOP=1 -q -c "CREATE ROLE service_role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"

echo "== esquema + migraciones PENDIENTES reales =="
MIGS=(
  supabase/pending_migrations/20260812210000_reparse_state_and_apply_plan.sql
  supabase/pending_migrations/20260814000000_reparse_claim_token_p05.sql
  supabase/pending_migrations/20260815120000_reparse_lease_p06.sql
)
psql -v ON_ERROR_STOP=1 -q -f supabase/tests/reparse_p05_shim.sql
for m in "${MIGS[@]}"; do psql -v ON_ERROR_STOP=1 -q -f "$m"; done
psql -v ON_ERROR_STOP=1 -q -f supabase/tests/reparse_p06_shim.sql
echo "   manifiesto:"; sha256sum "${MIGS[@]}" supabase/tests/reparse_p06_shim.sql

echo "== suites de integración (handler + RPC reales, todo como worker) =="
P05_LIVE=1 P05_PGHOST="$SOCK" P05_PGDATABASE=p06 P05_PGUSER=service_role P05_PGOWNER=p06owner \
P06_LIVE=1 P06_PGHOST="$SOCK" P06_PGDATABASE=p06 P06_PGUSER=service_role P06_PGOWNER=p06owner \
  bunx vitest run --fileParallelism=false src/test/reparseP05Live.test.ts src/test/reparseP06Live.test.ts

echo "PASS · P0.6 verificado contra PostgreSQL efímero real"
