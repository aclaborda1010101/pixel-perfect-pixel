#!/usr/bin/env bash
# =====================================================================
# WAVE 1A.3 P0.3 · RUNNER LOCAL DESECHABLE, SIN SHIMS
# =====================================================================
# Reglas duras de esta versión (P0.3):
#   - CERO shims: no se neutraliza ningún CREATE EXTENSION, no se reescribe
#     SQL con sed, no se omite ninguna migración, no se inyectan columnas
#     ni filas de deriva, no se traga ningún error y no hay reintentos.
#   - Se aplica un SNAPSHOT VERSIONADO EXACTO del esquema inmediatamente
#     anterior a 1A.2 (con checksum y procedencia declarada) y después,
#     sin tocar un byte, 1A.2 -> 1A.3.
#   - Si falta el snapshot exacto, su checksum/procedencia, o alguna
#     extensión real (pg_cron, pg_net, vector, pgcrypto, pg_trgm),
#     el runner sale con SKIP / NO VERIFICADO (exit 3) y NO declara
#     ninguna aplicabilidad.
#   - Aislamiento: clúster efímero propio creado con initdb, sin red
#     (listen_addresses='', sólo socket unix en un temporal), base
#     aleatoria y ROL DEDICADO no superusuario que ejecuta toda la cadena.
#   - Reporte individual por caso, SIN fail-fast, sentinel final y
#     exit != 0 si falla cualquiera.
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

die()  { echo "ABORTADO: $*" >&2; exit 2; }
skip() { echo "SKIP / NO VERIFICADO: $*" >&2; echo "SENTINEL: WAVE1A3_P03_NO_VERIFICADO"; exit 3; }

# --- 0. Ninguna conexión suministrada puede influir -------------------
for v in DATABASE_URL SUPABASE_DB_URL PGHOST PGPORT PGUSER PGDATABASE \
         PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGURI PGCONNECT_TIMEOUT; do
  if [ -n "${!v:-}" ]; then
    die "La variable $v está definida. Este runner sólo opera contra un clúster efímero propio; no acepta destinos externos."
  fi
done
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS

for bin in initdb pg_ctl psql pg_config sha256sum; do
  command -v "$bin" >/dev/null 2>&1 || skip "$bin no disponible: no hay entorno local aislado."
done

# --- 0.a Extensiones REALES o SKIP (nunca shim) -----------------------
EXTDIR="$(pg_config --sharedir)/extension"
for ext in pgcrypto pg_trgm vector pg_cron pg_net; do
  [ -f "$EXTDIR/$ext.control" ] \
    || skip "la extensión real '$ext' no está instalada en este entorno; sin shims no se puede aplicar la cadena. NO se declara aplicabilidad."
done

# --- 0.b Snapshot exacto pre-1A.2 con checksum y procedencia ----------
SNAP="$ROOT/supabase/tests/wave1a3_snapshot_pre_1a2.sql"
SNAP_SUM="$SNAP.sha256"
SNAP_PROV="$SNAP.provenance"
for f in "$SNAP" "$SNAP_SUM" "$SNAP_PROV"; do
  [ -f "$f" ] || skip "falta $(basename "$f"): no hay snapshot versionado EXACTO del esquema inmediatamente anterior a 1A.2 con checksum y procedencia. NO se declara aplicabilidad."
done
( cd "$(dirname "$SNAP")" && sha256sum -c "$(basename "$SNAP_SUM")" >/dev/null 2>&1 ) \
  || die "el checksum del snapshot pre-1A.2 no coincide: la procedencia no es verificable."

# --- 0.c El servidor no puede arrancar como root ----------------------
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
DATA="$WORK/data"; SOCK="$WORK/sock"; mkdir -p "$SOCK"

cleanup() {
  [ -d "$DATA" ] && pg_ctl -D "$DATA" -m immediate -w stop >/dev/null 2>&1
  rm -rf "$WORK"
  echo "Clúster efímero destruido (base $TESTDB y rol $ROLE incluidos)."
}
trap cleanup EXIT

# --- 1. Clúster efímero sin red --------------------------------------
initdb -D "$DATA" -U "$ADMIN" -A trust --no-locale --encoding=UTF8 >"$WORK/initdb.log" 2>&1 \
  || { sed -n '1,40p' "$WORK/initdb.log" >&2; skip "initdb falló."; }

pg_ctl -D "$DATA" -w -l "$WORK/pg.log" \
  -o "-c listen_addresses='' -k '$SOCK' -c fsync=off -c full_page_writes=off -c synchronous_commit=off -c shared_preload_libraries=pg_cron -c cron.database_name=$TESTDB" \
  start >/dev/null 2>&1 || { sed -n '1,60p' "$WORK/pg.log" >&2; skip "el clúster efímero no arranca con pg_cron precargado."; }

PSQL_ADMIN=(psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d postgres -q)
"${PSQL_ADMIN[@]}" -c 'SELECT 1' >/dev/null || skip "el clúster efímero no acepta conexiones."

# --- 2. Rol dedicado NO superusuario + base aleatoria -----------------
"${PSQL_ADMIN[@]}" -c "CREATE ROLE \"$ROLE\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" \
  || die "no se pudo crear el rol dedicado"
"${PSQL_ADMIN[@]}" -c "CREATE DATABASE \"$TESTDB\" OWNER \"$ROLE\";" \
  || die "no se pudo crear la base desechable"

# Extensiones REALES (único paso admin: requieren superusuario). Sin || true.
for ext in pgcrypto '"uuid-ossp"' pg_trgm vector pg_cron pg_net; do
  psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q \
    -c "CREATE EXTENSION IF NOT EXISTS $ext;" >"$WORK/ext.log" 2>&1 \
    || { sed -n '1,20p' "$WORK/ext.log" >&2; skip "no se pudo crear la extensión real $ext."; }
done

PSQL_TEST=(psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ROLE" -d "$TESTDB" -q)
IS_SUPER="$("${PSQL_TEST[@]}" -At -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")"
[ "$IS_SUPER" = "f" ] || die "el rol de pruebas no puede ser superusuario (rolsuper=$IS_SUPER)"

# --- 3. Snapshot exacto -> 1A.2 -> 1A.3, sin tocar ficheros -----------
CHAIN=(
  "$SNAP"
  "$ROOT/supabase/pending_migrations/20260810164500_wave1a_registral_rebuild_seguro.sql"
  "$ROOT/supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql"
)
echo "--- MANIFIESTO DE LA CADENA (sha256) ---"
echo "PROCEDENCIA: $(cat "$SNAP_PROV")"
for f in "${CHAIN[@]}"; do
  [ -f "$f" ] || die "falta un eslabón de la cadena: $f"
  echo "APLICA   $(sha256sum "$f" | cut -c1-16)  $(basename "$f")"
done
echo "--- FIN DEL MANIFIESTO (${#CHAIN[@]} entradas, 0 shims, 0 omisiones) ---"

for f in "${CHAIN[@]}"; do
  if ! "${PSQL_TEST[@]}" -f "$f" >"$WORK/last.log" 2>&1; then
    sed -n '1,60p' "$WORK/last.log" >&2
    die "$(basename "$f") no aplica con el rol dedicado. Sin reintentos: la base se destruye."
  fi
done

# --- 4. Atomicidad y presencia de la 1A.3 EXACTA ----------------------
grep -qiE '^[[:space:]]*BEGIN[[:space:]]*;' "${CHAIN[2]}" \
  || die "la migración 1A.3 debe abrir transacción explícita (BEGIN;)"
grep -qiE '^[[:space:]]*COMMIT[[:space:]]*;' "${CHAIN[2]}" \
  || die "la migración 1A.3 debe cerrar la transacción (COMMIT;)"

"${PSQL_TEST[@]}" -c "DO \$\$
BEGIN
  IF to_regprocedure('public.p0_safe_int(text)') IS NULL
     OR to_regprocedure('public.p0_locator_link_diag(jsonb,text,text,text,text,text,text,text,numeric)') IS NULL
     OR to_regprocedure('public.p0_nota_unit_locators(uuid)') IS NULL
     OR to_regprocedure('public.p0_nota_unit_cross_type_unverified(uuid)') IS NULL
     OR to_regprocedure('public.p0_nota_unit_aliases(uuid)') IS NULL
     OR to_regclass('public.v_p0_rights_staging') IS NULL THEN
    RAISE EXCEPTION 'La migración 1A.3 P0.3 no está aplicada en la base de prueba';
  END IF;
END \$\$;" || die "verificación de presencia 1A.3 P0.3 fallida"

# --- 5. Suites: reporte individual, SIN fail-fast ---------------------
for f in "$ROOT/supabase/tests/wave1a3_fixtures.sql" \
         "$ROOT/supabase/tests/wave1a_property_rights_cases.sql"; do
  [ -f "$f" ] || continue
  grep -qiE '^[[:space:]]*ROLLBACK[[:space:]]*;' "$f" \
    || die "las fixtures deben terminar en ROLLBACK: $f"
  if grep -qiE '^[[:space:]]*COMMIT[[:space:]]*;' "$f"; then
    die "las fixtures no pueden confirmar: $f"
  fi
done

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

run_suite "puros_1a3"       "$ROOT/supabase/tests/wave1a3_pure_cases.sql"
run_suite "invariantes_1a2" "$ROOT/supabase/tests/wave1a_property_rights_cases.sql"
run_suite "fixtures_1a3"    "$ROOT/supabase/tests/wave1a3_fixtures.sql"

if [ "$FAILED" != "0" ]; then
  echo "WAVE 1A.3 P0.3 · integración: NO-GO (al menos un caso en rojo)"
  echo "SENTINEL: WAVE1A3_P03_NO_GO"
  exit 1
fi
echo "WAVE 1A.3 P0.3 · integración: PASS (clúster efímero, base $TESTDB, rol $ROLE, 0 shims)"
echo "SENTINEL: WAVE1A3_P03_PASS"
