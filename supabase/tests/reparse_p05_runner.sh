#!/usr/bin/env bash
# REPARSEO P0.5 — runner AISLADO: cluster PostgreSQL efímero local (initdb),
# sin red, rol dedicado no-superusuario (service_role). Aplica las migraciones
# PENDIENTES REALES y ejecuta la suite de integración que llama a las RPC
# reales desde el adaptador (deps.ts) y el handler.
# No toca la base del proyecto: PG* del entorno se descartan.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
# El servidor no puede arrancar como root: re-ejecuta como usuario local sin privilegios.
if [ "$(id -u)" = "0" ]; then
  RUNAS="${P05_LOCAL_USER:-}"
  if [ -z "$RUNAS" ] || ! id "$RUNAS" >/dev/null 2>&1 || ! command -v setpriv >/dev/null 2>&1; then
    echo "SKIP / NO VERIFICADO: define P05_LOCAL_USER con un usuario local sin privilegios." >&2
    exit 3
  fi
  exec setpriv --reuid="$(id -u "$RUNAS")" --regid="$(id -g "$RUNAS")" --clear-groups \
       env HOME=/tmp P05_LOCAL_USER= bash "${BASH_SOURCE[0]}" "$@"
fi
TMP="$(mktemp -d /tmp/p05cluster.XXXXXX)"
DATA="$TMP/data"; SOCK="$TMP/sock"; mkdir -p "$SOCK"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSSLMODE || true
cleanup() { pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== initdb (efímero, sin red) =="
initdb -D "$DATA" -U p05owner --auth=trust >"$TMP/initdb.log" 2>&1
pg_ctl -D "$DATA" -o "-k $SOCK -c listen_addresses=''" -l "$TMP/pg.log" start >/dev/null
export PGHOST="$SOCK" PGUSER=p05owner PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE p05;" 
export PGDATABASE=p05
psql -v ON_ERROR_STOP=1 -q -c "CREATE ROLE service_role LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"

echo "== esquema shim + migraciones pendientes REALES =="
psql -v ON_ERROR_STOP=1 -q -f supabase/tests/reparse_p05_shim.sql
psql -v ON_ERROR_STOP=1 -q -f supabase/pending_migrations/20260812210000_reparse_state_and_apply_plan.sql
psql -v ON_ERROR_STOP=1 -q -f supabase/pending_migrations/20260814000000_reparse_claim_token_p05.sql
echo "   manifiesto:"; sha256sum supabase/pending_migrations/20260812210000_reparse_state_and_apply_plan.sql supabase/pending_migrations/20260814000000_reparse_claim_token_p05.sql

echo "== suite de integración (adaptador + RPC reales) =="
P05_LIVE=1 P05_PGHOST="$SOCK" P05_PGDATABASE=p05 P05_PGUSER=service_role \
  bunx vitest run src/test/reparseP05Live.test.ts
