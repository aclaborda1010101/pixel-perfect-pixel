#!/usr/bin/env bash
# =====================================================================
# WAVE 1A.3 · RUNNER DE INTEGRACIÓN (base desechable, nunca producción)
# =====================================================================
# Crea una base LOCAL desechable wave1a_test_<sufijo>, aplica la cadena
# exacta de checkout, verifica que la 1A.3 está presente, ejecuta las
# fixtures y DESTRUYE la base siempre (trap EXIT).
#
# Salvaguardas (ninguna depende de un GUC falsificable):
#   - El host debe ser loopback (127.0.0.1 / ::1 / localhost).
#   - Se rechaza cualquier URL no local y la base "postgres".
#   - Se exige un rol dedicado (WAVE1A_TEST_ROLE), nunca el superusuario
#     de un proyecto real.
#   - El nombre de la base debe empezar por wave1a_test_ (las fixtures lo
#     revalidan con current_database()).
#
# Uso:
#   PGHOST=127.0.0.1 PGPORT=54322 WAVE1A_TEST_ROLE=wave1a_tester \
#   PGPASSWORD=... bash supabase/tests/wave1a3_integration_runner.sh
# =====================================================================
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54322}"
PGUSER="${PGUSER:-postgres}"
ROLE="${WAVE1A_TEST_ROLE:-}"
ADMIN_DB="${WAVE1A_ADMIN_DB:-postgres}"
SUFIJO="$(date +%s)_$$"
TESTDB="wave1a_test_${SUFIJO}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

die() { echo "ABORTADO: $*" >&2; exit 2; }

# --- 1. Host obligatoriamente local ----------------------------------
case "$PGHOST" in
  127.0.0.1|::1|localhost|host.docker.internal) ;;
  *) die "PGHOST='$PGHOST' no es loopback. Este runner solo opera contra Supabase local." ;;
esac
[ -n "${DATABASE_URL:-}" ] && case "$DATABASE_URL" in
  *supabase.co*|*supabase.in*|*.pooler.*) die "DATABASE_URL apunta a un proyecto remoto." ;;
esac
[ -n "$ROLE" ] || die "Define WAVE1A_TEST_ROLE con un rol dedicado de pruebas."
[ "$ROLE" != "postgres" ] || die "El rol dedicado no puede ser 'postgres'."

PSQL_ADMIN=(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$ADMIN_DB" -q)

command -v psql >/dev/null 2>&1 || die "psql no disponible: no hay runner local, ejecuta solo los tests puros."
"${PSQL_ADMIN[@]}" -c 'SELECT 1' >/dev/null 2>&1 || \
  die "No hay Supabase local accesible en $PGHOST:$PGPORT: ejecuta solo los tests puros."

# --- 2. Base desechable y limpieza garantizada -----------------------
cleanup() {
  "${PSQL_ADMIN[@]}" -c "DROP DATABASE IF EXISTS \"$TESTDB\" WITH (FORCE);" >/dev/null 2>&1 || true
  echo "Base desechable $TESTDB destruida."
}
trap cleanup EXIT

"${PSQL_ADMIN[@]}" -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') THEN
    EXECUTE format('CREATE ROLE %I LOGIN', '$ROLE');
  END IF;
END \$\$;"
"${PSQL_ADMIN[@]}" -c "CREATE DATABASE \"$TESTDB\" OWNER \"$ROLE\";"

PSQL_TEST=(psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TESTDB" -q)

# --- 3. Cadena EXACTA de checkout ------------------------------------
CHAIN=(
  "$ROOT/supabase/migrations"
  "$ROOT/supabase/pending_migrations/20260810164500_wave1a_registral_rebuild_seguro.sql"
  "$ROOT/supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql"
)

if [ -d "${CHAIN[0]}" ]; then
  for f in $(ls "${CHAIN[0]}"/*.sql 2>/dev/null | sort); do
    "${PSQL_TEST[@]}" -f "$f" >/dev/null
  done
fi
"${PSQL_TEST[@]}" -f "${CHAIN[1]}" >/dev/null
"${PSQL_TEST[@]}" -f "${CHAIN[2]}" >/dev/null

# --- 4. Verificar que la 1A.3 EXACTA está presente -------------------
"${PSQL_TEST[@]}" -c "DO \$\$
BEGIN
  IF to_regprocedure('public.p0_nota_date_conflict(jsonb)') IS NULL
     OR to_regprocedure('public.p0_locator_valid(text,text,text)') IS NULL
     OR to_regprocedure('public.p0_nota_ownership_signature(uuid)') IS NULL
     OR to_regclass('public.v_p0_notas_listo_sin_titulares') IS NULL THEN
    RAISE EXCEPTION 'La migración 1A.3 no está aplicada en la base de prueba';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='v_p0_rights_staging'
      AND column_name IN ('layer_safe','row_safe_pre_layer')
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'v_p0_rights_staging no expone layer_safe y row_safe_pre_layer';
  END IF;
END \$\$;"

# --- 5. Tests puros y fixtures ---------------------------------------
"${PSQL_TEST[@]}" -f "$ROOT/supabase/tests/wave1a3_pure_cases.sql"
"${PSQL_TEST[@]}" -f "$ROOT/supabase/tests/wave1a3_fixtures.sql"

echo "WAVE 1A.3 · integración: PASS (base $TESTDB)"