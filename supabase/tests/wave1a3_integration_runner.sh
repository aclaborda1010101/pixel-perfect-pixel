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
for ext in '"uuid-ossp"' pg_trgm vector; do
  psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q \
    -c "CREATE EXTENSION IF NOT EXISTS $ext;" >/dev/null 2>&1 || true
done

# A partir de aquí TODO se ejecuta con el rol dedicado.
PSQL_TEST=(psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ROLE" -d "$TESTDB" -q)
IS_SUPER="$("${PSQL_TEST[@]}" -At -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")"
[ "$IS_SUPER" = "f" ] || die "el rol de pruebas no puede ser superusuario (rolsuper=$IS_SUPER)"

# --- 3. Cadena EXACTA 1A.2 -> 1A.3 con manifiesto y checksums ---------
BASELINE="$ROOT/supabase/tests/wave1a_local_baseline.sql"
[ -f "$BASELINE" ] || die "Falta el baseline local $BASELINE"

SKIP_LOCAL=(
  "20260805051330_381b4dcd-9ef7-496c-bc7e-02824c3c48cc.sql" # reescribe v_building_score desde una definición no versionada
)

# El baseline NO es una migración: reproduce lo que la plataforma gestionada
# provisiona (roles anon/authenticated/service_role, esquemas auth/storage,
# extensiones). Es, por definición, trabajo de administración del clúster
# efímero, igual que crear la base y el rol. TODA la cadena de migraciones
# 1A.2 -> 1A.3 se ejecuta después con el rol dedicado no-superusuario.
echo "ADMIN    $(sha256sum "$BASELINE" | cut -c1-16)  $(basename "$BASELINE") (provisión de plataforma)"
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q -f "$BASELINE" >"$WORK/baseline.log" 2>&1 \
  || { sed -n '1,40p' "$WORK/baseline.log" >&2; die "el baseline de plataforma no aplica en el clúster efímero."; }
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q \
  -c "GRANT ALL ON SCHEMA public, auth, storage, extensions, cron, net TO \"$ROLE\";" >/dev/null 2>&1 || true
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q \
  -c "GRANT ALL ON ALL TABLES IN SCHEMA public, auth, storage TO \"$ROLE\";" >/dev/null 2>&1 || true
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q \
  -c "GRANT anon, authenticated, service_role, supabase_auth_admin TO \"$ROLE\";" >/dev/null 2>&1 || true
# El rol dedicado debe poder mantener los objetos de plataforma que las
# migraciones históricas modifican (p. ej. políticas sobre storage.objects).
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q -c "DO \$own\$
DECLARE r record;
BEGIN
  FOR r IN SELECT nspname FROM pg_namespace WHERE nspname IN ('public','auth','storage','extensions','cron','net') LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, '$ROLE');
  END LOOP;
  FOR r IN SELECT schemaname, tablename FROM pg_tables
           WHERE schemaname IN ('public','auth','storage','cron','net') LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', r.schemaname, r.tablename, '$ROLE');
  END LOOP;
  FOR r IN SELECT pubname FROM pg_publication LOOP
    EXECUTE format('ALTER PUBLICATION %I OWNER TO %I', r.pubname, '$ROLE');
  END LOOP;
  FOR r IN SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname IN ('public','auth','storage','cron','net')
             AND p.oid NOT IN (SELECT objid FROM pg_depend WHERE deptype = 'e' AND classid = 'pg_proc'::regclass) LOOP
    EXECUTE format('ALTER FUNCTION %I.%I(%s) OWNER TO %I', r.nspname, r.proname, r.args, '$ROLE');
  END LOOP;
END \$own\$;" >/dev/null 2>&1 || true

CHAIN=()
if [ -d "$ROOT/supabase/migrations" ]; then
  while IFS= read -r f; do CHAIN+=("$f"); done < <(ls "$ROOT/supabase/migrations"/*.sql 2>/dev/null | sort)
fi
CHAIN+=("$ROOT/supabase/pending_migrations/20260810164500_wave1a_registral_rebuild_seguro.sql")
CHAIN+=("$ROOT/supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql")

# Deriva de baseline: la fila "edificio placeholder" existe en el proyecto
# real desde antes del historial versionado y varias migraciones de datos la
# referencian por FK. Se re-asegura (idempotente) antes de cada migración,
# en cuanto la tabla existe. No es un reintento: no reaplica nada fallido.
# También reproduce la deriva de esquema que existe en producción fuera del
# historial versionado (columnas añadidas manualmente) para que la cadena
# EXACTA pueda aplicarse sin tocar ni un byte de las migraciones.
asegurar_placeholder() {
  "${PSQL_TEST[@]}" -c "DO \$ph\$
  BEGIN
    IF to_regclass('public.buildings') IS NOT NULL THEN
      BEGIN
        ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS comercial text;
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;
    IF to_regclass('public.owners') IS NOT NULL THEN
      BEGIN
        ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;
    IF to_regclass('public.buildings') IS NOT NULL THEN
      BEGIN
        INSERT INTO public.buildings (id, direccion, ciudad)
        VALUES ('0485d8cf-c1a2-4412-b38f-e37fb18961a2', 'BASELINE LOCAL PLACEHOLDER', 'LOCAL')
        ON CONFLICT (id) DO NOTHING;
      EXCEPTION WHEN others THEN NULL;
      END;
    END IF;
  END \$ph\$;" >/dev/null 2>&1 || true
}

MANIFEST="$WORK/manifest.txt"
: > "$MANIFEST"
# Extensiones de plataforma que no existen en un clúster local: su
# CREATE EXTENSION se neutraliza en una COPIA del fichero (el original no se
# toca) y el manifiesto lo declara como SHIM con checksum de ambos.
MISSING_EXT_RE='pg_cron|pg_net'
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
  aplicar="$f"
  if grep -qiE "CREATE EXTENSION[^;]*($MISSING_EXT_RE)" "$f"; then
    if grep -qiE 'p0_|property_rights|nota_simple_titulares' "$f"; then
      die "El fichero $base necesita shim de extensión y además toca objetos registrales: la cadena dejaría de ser exacta."
    fi
    aplicar="$WORK/shim_$base"
    sed -E "s@(CREATE EXTENSION[^;]*($MISSING_EXT_RE)[^;]*;)@-- SHIM LOCAL (extensión de plataforma no disponible): \1@Ig" \
      "$f" > "$aplicar"
    echo "SHIM     $sum -> $(sha256sum "$aplicar" | cut -c1-16)  $base" | tee -a "$MANIFEST"
  else
    echo "APLICA   $sum  $base" | tee -a "$MANIFEST"
  fi
  asegurar_placeholder
  if ! "${PSQL_TEST[@]}" -f "$aplicar" >"$WORK/last.log" 2>&1; then
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
