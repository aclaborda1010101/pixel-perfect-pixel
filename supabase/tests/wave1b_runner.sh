#!/usr/bin/env bash
# =====================================================================
# WAVE 1B · runner AISLADO (clúster PostgreSQL efímero, sin red).
#   fixture declarado -> 1A.2 -> 1A.3 -> 1B -> casos.
# Cada eslabón se aplica con ON_ERROR_STOP y en una única transacción.
# Sin shims de lógica, sin sed sobre las migraciones, sin errores tragados.
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
die()  { echo "FALLO: $*" >&2; echo "SENTINEL: WAVE1B_FAIL"; exit 1; }
skip() { echo "SKIP / NO VERIFICADO: $*" >&2; echo "SENTINEL: WAVE1B_NO_VERIFICADO"; exit 3; }

PGBIN="${WAVE1B_PG_PREFIX:-}"
if [ -n "$PGBIN" ]; then PGBIN="$PGBIN/bin"; else PGBIN="$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/x)")"; fi
[ -x "$PGBIN/initdb" ] && [ -x "$PGBIN/psql" ] || skip "no hay PostgreSQL local (initdb/psql)."

# Las extensiones deben ser REALES: si falta el .control, no se sustituye.
EXTDIR="$(cd "$PGBIN/../share/postgresql/extension" 2>/dev/null && pwd)" || true
[ -n "${EXTDIR:-}" ] && [ -d "$EXTDIR" ] || skip "no se localiza el directorio de extensiones."
for ext in pgcrypto uuid-ossp pg_trgm vector; do
  [ -f "$EXTDIR/$ext.control" ] || skip "falta la extensión real '$ext'; sin shims no se declara aplicabilidad."
done

AS=""
if [ "$(id -u)" = "0" ]; then
  RUNAS="${WAVE1B_LOCAL_USER:-lovable}"
  id "$RUNAS" >/dev/null 2>&1 && command -v setpriv >/dev/null 2>&1 \
    || skip "PostgreSQL no arranca como root: define WAVE1B_LOCAL_USER."
  AS="setpriv --reuid=$(id -u "$RUNAS") --regid=$(id -g "$RUNAS") --clear-groups env HOME=/tmp"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wave1b.XXXXXXXX")"; chmod 777 "$WORK"
DATA="$WORK/data"; SOCK="$WORK/sock"; mkdir -p "$SOCK"; chmod 777 "$SOCK"
unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGOPTIONS || true
cleanup(){ $AS "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

$AS "$PGBIN/initdb" -D "$DATA" -U w1badmin -A trust --no-locale --encoding=UTF8 >"$WORK/initdb.log" 2>&1 \
  || { tail -20 "$WORK/initdb.log" >&2; skip "initdb falló."; }
$AS "$PGBIN/pg_ctl" -D "$DATA" -w -l "$WORK/pg.log" \
  -o "-k $SOCK -c listen_addresses='' -c fsync=off -c synchronous_commit=off" start >/dev/null 2>&1 \
  || { tail -30 "$WORK/pg.log" >&2; skip "el clúster efímero no arranca."; }

RAND="$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')"
DB="wave1b_test_${RAND}"; ROLE="wave1b_role_${RAND}"
export PGHOST="$SOCK" PGUSER=w1badmin PGDATABASE=postgres
PSQL_ADMIN=("$PGBIN/psql" -v ON_ERROR_STOP=1 -q -h "$SOCK" -U w1badmin -d postgres)
"${PSQL_ADMIN[@]}" -c "CREATE ROLE \"$ROLE\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" >/dev/null
for r in anon authenticated service_role; do
  "${PSQL_ADMIN[@]}" -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$r') THEN CREATE ROLE $r NOLOGIN; END IF; END \$\$;" >/dev/null
done
"${PSQL_ADMIN[@]}" -c "CREATE DATABASE \"$DB\" OWNER \"$ROLE\";" >/dev/null
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -h "$SOCK" -U w1badmin -d "$DB" \
  -c 'CREATE EXTENSION pgcrypto; CREATE EXTENSION "uuid-ossp"; CREATE EXTENSION pg_trgm;' >/dev/null \
  || die "no se pudieron crear las extensiones reales"

PSQL=("$PGBIN/psql" -v ON_ERROR_STOP=1 -q -h "$SOCK" -U "$ROLE" -d "$DB")
[ "$("${PSQL[@]}" -At -c "SELECT rolsuper FROM pg_roles WHERE rolname=current_user")" = "f" ] \
  || die "el rol de pruebas no puede ser superusuario"

CHAIN=(
  "$ROOT/supabase/tests/wave1b_fixture_schema.sql"
  "$ROOT/supabase/pending_migrations/20260810164500_wave1a_registral_rebuild_seguro.sql"
  "$ROOT/supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql"
  "$ROOT/supabase/pending_migrations/20260817000000_wave1b_materializacion_cuota.sql"
)
echo "--- MANIFIESTO (sha256) ---"
for f in "${CHAIN[@]}"; do
  [ -f "$f" ] || die "falta un eslabón de la cadena: $f"
  echo "APLICA $(sha256sum "$f" | cut -c1-16)  $(basename "$f")"
done
echo "--- FIN DEL MANIFIESTO (${#CHAIN[@]} entradas, 0 shims, 0 omisiones) ---"

for f in "${CHAIN[@]}"; do
  "${PSQL[@]}" -1 -f "$f" >"$WORK/$(basename "$f").log" 2>&1 \
    || { tail -25 "$WORK/$(basename "$f").log" >&2; die "no se pudo aplicar $(basename "$f")"; }
  echo "OK  $(basename "$f")"
done

for caso in "$ROOT"/supabase/tests/wave1b_cases*.sql; do
  [ -f "$caso" ] || continue
  "${PSQL[@]}" -f "$caso" >"$WORK/casos.log" 2>&1 \
    || { tail -40 "$WORK/casos.log" >&2; die "suite $(basename "$caso") FALLÓ"; }
  grep -E '^(psql:)?.*(CASO OK|INVARIANTE OK)' "$WORK/casos.log" | sed 's/^psql:[^ ]* //' || true
  echo "SUITE PASS  $(basename "$caso")"
done

echo "WAVE 1B · integración: PASS (clúster efímero, base $DB, rol $ROLE, 0 shims)"
echo "SENTINEL: WAVE1B_PASS"
