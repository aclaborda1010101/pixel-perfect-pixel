#!/usr/bin/env bash
# =====================================================================
# WAVE 1A.3 P0.2 · RUNNER LOCAL DESECHABLE (IMPOSIBLE CONTRA PRODUCCIÓN)
# =====================================================================
# Este runner NO se conecta a ningún servidor existente. Crea con initdb
# un CLÚSTER EFÍMERO propio, sin red (listen_addresses='', sólo socket
# unix dentro de un directorio temporal), una base aleatoria
# wave1a_test_<random> y un ROL DEDICADO no-superusuario. TODAS las
# migraciones y fixtures se ejecutan con ESE rol. El superusuario local
# del clúster efímero sólo crea y destruye base + rol.
#
# Garantías:
#   - Se RECHAZA cualquier variable de conexión suministrada
#     (DATABASE_URL, SUPABASE_DB_URL, PGHOST, PGPORT, PGUSER, PGDATABASE,
#      PGPASSWORD, PGSERVICE...). No hay host.docker.internal, ni túnel,
#      ni TCP: el clúster no escucha en ningún puerto.
#   - trap EXIT: se para el clúster y se borra el directorio de datos
#     (base + rol incluidos) incluso si algo falla.
#   - Cadena EXACTA 1A.2 -> 1A.3 en orden, con manifiesto y checksums.
#   - Sin reintentos sobre una migración parcialmente aplicada: si algo
#     falla, se destruye todo y se sale con error.
#   - Si no se puede crear el entorno local aislado: SKIP / NO VERIFICADO
#     (exit 3) y NO se declara aplicabilidad.
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

die()  { echo "ABORTADO: $*" >&2; exit 2; }
skip() { echo "SKIP / NO VERIFICADO: $*" >&2; exit 3; }

# --- 0. Ninguna conexión suministrada puede influir -------------------
for v in DATABASE_URL SUPABASE_DB_URL PGHOST PGPORT PGUSER PGDATABASE \
         PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGURI PGCONNECT_TIMEOUT; do
  if [ -n "${!v:-}" ]; then
    die "La variable $v está definida. Este runner sólo opera contra un clúster efímero propio; no acepta destinos externos."
  fi
done
export PGHOST= PGPORT= PGUSER= PGDATABASE= PGPASSWORD=
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

command -v initdb >/dev/null 2>&1 || skip "initdb no disponible: no se puede crear un clúster local aislado."
command -v pg_ctl >/dev/null 2>&1 || skip "pg_ctl no disponible."
command -v psql   >/dev/null 2>&1 || skip "psql no disponible."

# --- 0.b El servidor no puede arrancar como root ----------------------
if [ "$(id -u)" = "0" ]; then
  RUNAS="${WAVE1A_LOCAL_USER:-}"
  if [ -z "$RUNAS" ] || ! id "$RUNAS" >/dev/null 2>&1 || ! command -v setpriv >/dev/null 2>&1; then
    skip "PostgreSQL no arranca como root. Define WAVE1A_LOCAL_USER con un usuario local sin privilegios."
  fi
  exec setpriv --reuid="$(id -u "$RUNAS")" --regid="$(id -g "$RUNAS")" --clear-groups \
       env HOME=/tmp WAVE1A_LOCAL_USER= bash "${BASH_SOURCE[0]}" "$@"
fi

RAND="$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')"
TESTDB="wave1a_test_${RAND}"
ROLE="wave1a_role_${RAND}"
ADMIN="wave1a_admin_${RAND}"
case "$TESTDB" in wave1a_test_*) ;; *) die "nombre de base inválido: $TESTDB";; esac

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wave1a3.XXXXXXXX")" || skip "no se puede crear directorio temporal"
DATA="$WORK/data"
SOCK="$WORK/sock"
mkdir -p "$SOCK"

cleanup() {
  if [ -d "$DATA" ]; then
    pg_ctl -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
  echo "Clúster efímero destruido (base $TESTDB y rol $ROLE incluidos)."
}
trap cleanup EXIT

# --- 1. Clúster efímero sin red --------------------------------------
initdb -D "$DATA" -U "$ADMIN" -A trust --no-locale --encoding=UTF8 >"$WORK/initdb.log" 2>&1 \
  || { sed -n '1,40p' "$WORK/initdb.log" >&2; skip "initdb falló: no hay entorno local aislado."; }

pg_ctl -D "$DATA" -w -l "$WORK/pg.log" \
  -o "-c listen_addresses='' -k '$SOCK' -c fsync=off -c full_page_writes=off -c synchronous_commit=off" \
  start >/dev/null 2>&1 || { sed -n '1,60p' "$WORK/pg.log" >&2; skip "el clúster efímero no arranca."; }

PSQL_ADMIN=(psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d postgres -q)
"${PSQL_ADMIN[@]}" -c 'SELECT 1' >/dev/null || skip "el clúster efímero no acepta conexiones."

# --- 2. Rol dedicado NO superusuario + base aleatoria -----------------
"${PSQL_ADMIN[@]}" -c "CREATE ROLE \"$ROLE\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" \
  || die "no se pudo crear el rol dedicado"
"${PSQL_ADMIN[@]}" -c "CREATE DATABASE \"$TESTDB\" OWNER \"$ROLE\";" \
  || die "no se pudo crear la base desechable"

# Extensiones: único paso admin dentro de la base (requieren superusuario).
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' >/dev/null 2>&1 || true
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' >/dev/null 2>&1 || true

# A partir de aquí TODO se ejecuta con el rol dedicado.
PSQL_TEST=(psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ROLE" -d "$TESTDB" -q)
WHO="$("${PSQL_TEST[@]}" -At -c 'SELECT current_user || :: text || rolsuper::text FROM pg_roles WHERE rolname = current_user' 2>/dev/null || true)"
"${PSQL_TEST[@]}" -At -c "SELECT CASE WHEN rolsuper THEN 1/0 ELSE 1 END FROM pg_roles WHERE rolname = current_user" >/dev/null \
  || die "el rol de pruebas no puede ser superusuario"

# --- 3. Cadena EXACTA 1A.2 -> 1A.3 con manifiesto y checksums ---------
BASELINE="$ROOT/supabase/tests/wave1a_local_baseline.sql"
[ -f "$BASELINE" ] || die "Falta el baseline local $BASELINE"

SKIP_LOCAL=(
  "20260805051330_381b4dcd-9ef7-496c-bc7e-02824c3c48cc.sql" # reescribe v_building_score desde una definición no versionada
)

CHAIN=("$BASELINE")
if [ -d "$ROOT/supabase/migrations" ]; then
  while IFS= read -r f; do CHAIN+=("$f"); done < <(ls "$ROOT/supabase/migrations"/*.sql 2>/dev/null | sort)
fi
CHAIN+=("$ROOT/supabase/pending_migrations/20260810164500_wave1a_registral_rebuild_seguro.sql")
CHAIN+=("$ROOT/supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql")

MANIFEST="$WORK/manifest.txt"
: > "$MANIFEST"
echo "--- MANIFIESTO DE LA CADENA (sha256) ---"
for f in "${CHAIN[@]}"; do
  base="$(basename "$f")"
  skipthis=0
  for s in "${SKIP_LOCAL[@]}"; do [ "$base" = "$s" ] && skipthis=1; done
  sum="$(sha256sum "$f" | cut -c1-16)"
  if [ "$skipthis" = "1" ]; then
    if grep -qiE 'p0_|property_rights|notas_simples|nota_simple_titulares|building_owners' "$f"; then
      die "La migración omitida $base toca objetos registrales: la cadena dejaría de ser exacta."
    fi
    echo "OMITIDA  $sum  $base" | tee -a "$MANIFEST"
    continue
  fi
  echo "APLICA   $sum  $base" | tee -a "$MANIFEST"
  if ! "${PSQL_TEST[@]}" -f "$f" >"$WORK/last.log" 2>&1; then
    sed -n '1,40p' "$WORK/last.log" >&2
    # SIN REINTENTOS: una migración parcialmente aplicada invalida la base.
    die "La migración $base no aplica con el rol dedicado. La base se destruye; no se reintenta."
  fi
done
echo "--- FIN DEL MANIFIESTO ($(wc -l < "$MANIFEST") entradas) ---"

# --- 4. La 1A.3 EXACTA debe estar presente ----------------------------
"${PSQL_TEST[@]}" -c "DO \$\$
BEGIN
  IF to_regprocedure('public.p0_nota_date_conflict(jsonb)') IS NULL
     OR to_regprocedure('public.p0_locator_all_valid(text,text,text)') IS NULL
     OR to_regprocedure('public.p0_locator_link_ok(jsonb,text,text,text,text,text,text,text,numeric)') IS NULL
     OR to_regprocedure('public.p0_nota_ownership_signature(uuid)') IS NULL
     OR to_regclass('public.v_p0_notas_listo_sin_titulares') IS NULL THEN
    RAISE EXCEPTION 'La migración 1A.3 P0.2 no está aplicada en la base de prueba';
  END IF;
END \$\$;" || die "verificación de presencia 1A.3 fallida"

# --- 5. Suites: cada una se ejecuta y se reporta por separado ---------
FAILED=0
run_suite() {
  local nombre="$1" fichero="$2"
  if "${PSQL_TEST[@]}" -f "$fichero" >"$WORK/$nombre.log" 2>&1; then
    echo "SUITE PASS  $nombre"
  else
    echo "SUITE FAIL  $nombre"
    sed -n '1,200p' "$WORK/$nombre.log" >&2
    FAILED=1
  fi
  grep -E '^(CASO|NOTICE:  CASO)' "$WORK/$nombre.log" || true
}

run_suite "puros_1a3"    "$ROOT/supabase/tests/wave1a3_pure_cases.sql"
run_suite "invariantes_1a2" "$ROOT/supabase/tests/wave1a_property_rights_cases.sql"
run_suite "fixtures_1a3" "$ROOT/supabase/tests/wave1a3_fixtures.sql"

if [ "$FAILED" != "0" ]; then
  echo "WAVE 1A.3 P0.2 · integración: NO-GO (al menos un caso en rojo)"
  exit 1
fi
echo "WAVE 1A.3 P0.2 · integración: PASS (clúster efímero, base $TESTDB, rol $ROLE)"
