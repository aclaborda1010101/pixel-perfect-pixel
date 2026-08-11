#!/usr/bin/env bash
# =====================================================================
# WAVE 1A.3 P0.4 · RUNNER LOCAL DESECHABLE, SIN SHIMS, ATÓMICO
# =====================================================================
# Reglas duras (P0.4, endurecen las de P0.3):
#   - CERO shims: no se neutraliza ningún CREATE EXTENSION, no se reescribe
#     SQL con sed, no se omite ninguna migración y no hay reintentos.
#   - SNAPSHOT OBLIGATORIO: sin snapshot versionado pre-1A.2 + SHA256 +
#     procedencia => SKIP / NO VERIFICADO (exit 3). Jamás verde.
#   - ATOMICIDAD REAL: la cadena snapshot -> 1A.2 -> 1A.3 se aplica en UNA
#     SOLA transacción (psql -1 -v ON_ERROR_STOP=1). Antes se ejecuta una
#     prueba de FALLO TARDÍO: la misma cadena más una orden que falla al
#     final; tras el rollback el catálogo (checksum de objetos de public)
#     debe ser byte a byte el de partida.
#   - Aislamiento: clúster efímero propio (initdb), sin red, base aleatoria
#     y ROL DEDICADO no superusuario que ejecuta toda la cadena.
#   - Reporte individual por caso, SIN fail-fast, sentinel final.
# =====================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

die()  { echo "ABORTADO: $*" >&2; echo "SENTINEL: WAVE1A3_P04_NO_GO"; exit 2; }
skip() { echo "SKIP / NO VERIFICADO: $*" >&2; echo "SENTINEL: WAVE1A3_P04_NO_VERIFICADO"; exit 3; }

# --- 0. Ninguna conexión suministrada puede influir -------------------
for v in DATABASE_URL SUPABASE_DB_URL PGHOST PGPORT PGUSER PGDATABASE \
         PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGURI PGCONNECT_TIMEOUT; do
  if [ -n "${!v:-}" ]; then
    die "La variable $v está definida. Este runner sólo opera contra un clúster efímero propio; no acepta destinos externos."
  fi
done
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS

for bin in initdb pg_ctl psql sha256sum; do
  command -v "$bin" >/dev/null 2>&1 || skip "$bin no disponible: no hay entorno local aislado."
done

# --- 0.a Snapshot exacto pre-1A.2: fichero + checksum + procedencia ----
SNAP="$ROOT/supabase/tests/wave1a3_snapshot_pre_1a2.sql"
SNAP_EXT="$SNAP.extensions"
SNAP_ROLES="$SNAP.roles"
SNAP_SUM="$SNAP.sha256"
SNAP_PROV="$SNAP.provenance"

# --- 0.a.0 PUERTA ANTI-SHIM (P0.6) ------------------------------------
# Ni deriva, ni stubs, ni placeholders, ni sed sobre SQL versionado.
[ -e "$ROOT/supabase/tests/wave1a_baseline_drift.sql" ] \
  && die "P0.6: existe wave1a_baseline_drift.sql. Los shims están prohibidos."
if [ -s "$SNAP.NO_VERIFICADO" ]; then
  sed -n '1,6p' "$SNAP.NO_VERIFICADO" >&2
  skip "el generador declaró NO_VERIFICADO: no hay snapshot real pre-1A.2 y P0.6 prohíbe fabricarlo con shims."
fi
for f in "$SNAP" "$ROOT/supabase/tests/wave1a_local_baseline.sql"; do
  [ -f "$f" ] || continue
  grep -nEi 'BASELINE LOCAL PLACEHOLDER|placeholder|_wave1a_drift|drift|CREATE (OR REPLACE )?FUNCTION (cron|net)\.' "$f" \
    && die "P0.6: '$f' contiene shims/placeholders/stubs. Prohibido."
done

for f in "$SNAP" "$SNAP_EXT" "$SNAP_ROLES" "$SNAP_SUM" "$SNAP_PROV"; do
  [ -s "$f" ] || skip "falta $(basename "$f"): sin snapshot versionado EXACTO pre-1A.2 con checksum y procedencia no se declara aplicabilidad. Regenéralo con wave1a3_make_snapshot.sh."
done
( cd "$(dirname "$SNAP")" && sha256sum -c "$(basename "$SNAP_SUM")" >/dev/null 2>&1 ) \
  || die "el checksum del snapshot pre-1A.2 no coincide: la procedencia no es verificable."

# --- 0.a.1 PROCEDENCIA VALIDADA SEMÁNTICAMENTE (P0.6) -----------------
for campo in generador commit postgres corte migraciones_aplicadas migraciones_no_aplicables; do
  grep -q "^$campo=" "$SNAP_PROV" || die "la procedencia del snapshot no declara '$campo'."
done
PROV_COMMIT="$(sed -n 's/^commit=//p' "$SNAP_PROV" | head -1)"
echo "$PROV_COMMIT" | grep -qE '^[0-9a-f]{40}$' \
  || die "procedencia: commit='$PROV_COMMIT' no es un SHA de 40 hex."
( cd "$ROOT" && git -c safe.directory="$ROOT" cat-file -e "${PROV_COMMIT}^{commit}" 2>/dev/null ) \
  || die "procedencia: el commit $PROV_COMMIT no existe en este repositorio."
PROV_OMIT="$(sed -n 's/^migraciones_no_aplicables=//p' "$SNAP_PROV" | head -1)"
[ "$PROV_OMIT" = "0" ] || die "procedencia: migraciones_no_aplicables=$PROV_OMIT (debe ser 0)."
grep -qi '^deriva=.*drift' "$SNAP_PROV" \
  && die "procedencia: declara una deriva/shim. P0.6 lo prohíbe."
PROV_CUT="$(sed -n 's/^corte=.*< //p' "$SNAP_PROV" | head -1)"
echo "$PROV_CUT" | grep -qE '^[0-9]{14}$' || die "procedencia: corte '$PROV_CUT' no es un timestamp de 14 dígitos."

# Lista EXACTA y ORDENADA: ni una migración de más, ni una de menos, y el
# sha256 de cada fichero debe coincidir con el declarado.
PROV_LIST="$(mktemp)"; REPO_LIST="$(mktemp)"
sed -n '/^--- migraciones aplicadas/,$p' "$SNAP_PROV" | tail -n +2 > "$PROV_LIST"
for f in $(ls "$ROOT"/supabase/migrations/*.sql | LC_ALL=C sort); do
  b="$(basename "$f")"
  if [ "${b:0:14}" \< "$PROV_CUT" ]; then
    echo "$(sha256sum "$f" | cut -d' ' -f1)  $b" >> "$REPO_LIST"
  fi
done
PROV_N="$(grep -c . "$PROV_LIST" || true)"
REPO_N="$(grep -c . "$REPO_LIST" || true)"
PROV_DECL="$(sed -n 's/^migraciones_aplicadas=//p' "$SNAP_PROV" | head -1)"
[ "$PROV_N" = "$PROV_DECL" ] || die "procedencia: declara $PROV_DECL migraciones pero lista $PROV_N."
[ "$PROV_N" = "$REPO_N" ]   || die "procedencia: el corte del repo tiene $REPO_N migraciones y la procedencia $PROV_N (falta o sobra alguna)."
if ! diff -u "$REPO_LIST" "$PROV_LIST" > "$ROOT/.wave1a3_prov.diff" 2>&1; then
  sed -n '1,40p' "$ROOT/.wave1a3_prov.diff" >&2; rm -f "$ROOT/.wave1a3_prov.diff"
  die "procedencia: la lista ordenada de migraciones (nombre + sha256) NO coincide con el corte real del repositorio."
fi
rm -f "$ROOT/.wave1a3_prov.diff"
rm -f "$PROV_LIST" "$REPO_LIST"
echo "PROCEDENCIA PASS  commit=$PROV_COMMIT  migraciones=$PROV_N  omitidas=0  lista y sha256 exactos"

# --- 0.b Extensiones REALES exigidas POR EL PROPIO SNAPSHOT -----------
# El directorio de extensiones se deriva de pg_config y, si no existe, de
# la ubicación real de initdb. Nunca se sustituye una extensión por un shim.
if command -v pg_config >/dev/null 2>&1; then
  EXTDIR="$(pg_config --sharedir)/extension"
else
  EXTDIR="$(cd "$(dirname "$(command -v initdb)")/../share/postgresql/extension" 2>/dev/null && pwd)"
fi
[ -n "${EXTDIR:-}" ] && [ -d "$EXTDIR" ] || skip "no se localiza el directorio de extensiones de PostgreSQL."
REQ_EXT="$(sed -n 's/^CREATE EXTENSION IF NOT EXISTS \("\?\)\([A-Za-z0-9_-]*\)\1.*/\2/p' "$SNAP_EXT" | sort -u)"
[ -n "$REQ_EXT" ] || die "el snapshot no declara ninguna extensión: material incompleto."
for ext in $REQ_EXT; do
  [ -f "$EXTDIR/$ext.control" ] \
    || skip "la extensión real '$ext' (exigida por el snapshot) no está instalada; sin shims no se puede aplicar la cadena. NO se declara aplicabilidad."
done

# --- 0.c El servidor no puede arrancar como root ----------------------
if [ "$(id -u)" = "0" ]; then
  RUNAS="${WAVE1A_LOCAL_USER:-}"
  if [ -z "$RUNAS" ] || ! id "$RUNAS" >/dev/null 2>&1 || ! command -v setpriv >/dev/null 2>&1; then
    skip "PostgreSQL no arranca como root. Define WAVE1A_LOCAL_USER con un usuario local sin privilegios."
  fi
  exec setpriv --reuid="$(id -u "$RUNAS")" --regid="$(id -g "$RUNAS")" --clear-groups \
       env HOME="${TMPDIR:-/tmp}" WAVE1A_LOCAL_USER= bash "${BASH_SOURCE[0]}" "$@"
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

PRELOAD=""
case "$REQ_EXT" in *pg_cron*) PRELOAD="pg_cron";; esac
case "$REQ_EXT" in *pg_net*)  PRELOAD="${PRELOAD:+$PRELOAD,}pg_net";; esac

pg_ctl -D "$DATA" -w -l "$WORK/pg.log" \
  -o "-c listen_addresses='' -k '$SOCK' -c fsync=off -c full_page_writes=off -c synchronous_commit=off ${PRELOAD:+-c shared_preload_libraries='$PRELOAD'} -c cron.database_name=$TESTDB" \
  start >/dev/null 2>&1 || { sed -n '1,60p' "$WORK/pg.log" >&2; skip "el clúster efímero no arranca con las extensiones precargadas."; }

PSQL_ADMIN=(psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d postgres -q)
"${PSQL_ADMIN[@]}" -c 'SELECT 1' >/dev/null || skip "el clúster efímero no acepta conexiones."

# --- 2. Rol dedicado NO superusuario + base aleatoria -----------------
"${PSQL_ADMIN[@]}" -c "CREATE ROLE \"$ROLE\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;" \
  || die "no se pudo crear el rol dedicado"
"${PSQL_ADMIN[@]}" -c "CREATE DATABASE \"$TESTDB\" OWNER \"$ROLE\";" \
  || die "no se pudo crear la base desechable"

# Roles de plataforma declarados por el snapshot (globales del clúster).
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q -f "$SNAP_ROLES" >"$WORK/roles.log" 2>&1 \
  || { sed -n '1,30p' "$WORK/roles.log" >&2; die "no se pudieron crear los roles de plataforma declarados por el snapshot."; }

# Extensiones REALES tal y como las declara el snapshot (único paso admin:
# CREATE EXTENSION exige superusuario). Sin || true, sin sustituciones.
psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ADMIN" -d "$TESTDB" -q -f "$SNAP_EXT" >"$WORK/ext.log" 2>&1 \
  || { sed -n '1,30p' "$WORK/ext.log" >&2; skip "no se pudieron crear las extensiones reales declaradas por el snapshot."; }

PSQL_TEST=(psql -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ROLE" -d "$TESTDB" -q)
IS_SUPER="$("${PSQL_TEST[@]}" -At -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user")"
[ "$IS_SUPER" = "f" ] || die "el rol de pruebas no puede ser superusuario (rolsuper=$IS_SUPER)"

# --- 3. Manifiesto de la cadena --------------------------------------
CHAIN=(
  "$SNAP"
  "$ROOT/supabase/pending_migrations/20260810164500_wave1a_registral_rebuild_seguro.sql"
  "$ROOT/supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql"
)
echo "--- MANIFIESTO DE LA CADENA (sha256) ---"
sed -n 's/^/PROCEDENCIA  /p' "$SNAP_PROV" | sed -n '1,10p'
for f in "${CHAIN[@]}"; do
  [ -f "$f" ] || die "falta un eslabón de la cadena: $f"
  echo "APLICA   $(sha256sum "$f" | cut -c1-16)  $(basename "$f")"
done
echo "--- FIN DEL MANIFIESTO (${#CHAIN[@]} entradas, 0 shims, 0 omisiones) ---"

# La 1A.3 debe abrir y cerrar UNA sola transacción explícita.
NBEGIN=$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' "${CHAIN[2]}")
NCOMMIT=$(grep -ciE '^[[:space:]]*COMMIT[[:space:]]*;' "${CHAIN[2]}")
[ "$NBEGIN" = "1" ]  || die "la migración 1A.3 debe tener exactamente 1 BEGIN; (encontrados $NBEGIN)"
[ "$NCOMMIT" = "1" ] || die "la migración 1A.3 debe tener exactamente 1 COMMIT; (encontrados $NCOMMIT)"

cat "${CHAIN[@]}" > "$WORK/chain.sql"

# --- 4. ATOMICIDAD: fallo tardío => rollback total --------------------
# P0.5: el fingerprint es COMPLETO (columnas+tipos+defaults+nullability,
# constraints con definición y validación, índices con predicado,
# definiciones completas de views/functions, owners/grants/ACL, triggers,
# políticas, tipos y checksums de datos). Comparar nombres no vale.
FPSQL="$ROOT/supabase/tests/wave1a3_fingerprint.sql"
[ -f "$FPSQL" ] || die "falta el fingerprint completo: $FPSQL"

fingerprint() {  # $1 = fichero de salida
  "${PSQL_TEST[@]}" -At -f "$FPSQL" > "$1" 2>"$WORK/fp.err" \
    || { sed -n '1,40p' "$WORK/fp.err" >&2; die "no se pudo calcular el fingerprint completo"; }
  [ -s "$1" ] || die "fingerprint vacío: $1"
}

fingerprint "$WORK/fp_antes.txt"
CAT_ANTES="$(sha256sum "$WORK/fp_antes.txt" | cut -d' ' -f1)"
echo "FINGERPRINT previo: $(wc -l < "$WORK/fp_antes.txt") hechos, sha256=$CAT_ANTES"

# La variante de fallo tardío es la MISMA cadena, con la única diferencia
# de que el COMMIT final de la 1A.3 se sustituye por una excepción. Así
# ninguna transacción se confirma en toda la cadena y el rollback debe
# devolver el catálogo exactamente al estado de partida.
{
  cat "${CHAIN[0]}" "${CHAIN[1]}"
  awk 'BEGIN{IGNORECASE=1}
       /^[[:space:]]*COMMIT[[:space:]]*;[[:space:]]*$/ {
         print "-- P0.4 . FALLO TARDIO DELIBERADO en lugar del COMMIT final:";
         print "DO $wave1a3_fallo_tardio$ BEGIN";
         print "  RAISE EXCEPTION \\047WAVE1A3_FALLO_TARDIO_DELIBERADO\\047;";
         print "END $wave1a3_fallo_tardio$;";
         next }
       { print }' "${CHAIN[2]}"
} > "$WORK/chain_fail.sql"
grep -q 'WAVE1A3_FALLO_TARDIO_DELIBERADO' "$WORK/chain_fail.sql" \
  || die "no se pudo construir la variante de fallo tardío (¿COMMIT final ausente en 1A.3?)"

if psql -1 -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ROLE" -d "$TESTDB" -q -f "$WORK/chain_fail.sql" >"$WORK/atomic.log" 2>&1; then
  die "la prueba de atomicidad NO falló: la cadena no es una única transacción."
fi
grep -q 'WAVE1A3_FALLO_TARDIO_DELIBERADO' "$WORK/atomic.log" \
  || { sed -n '1,40p' "$WORK/atomic.log" >&2; die "la cadena falló ANTES del fallo tardío: no se puede evaluar la atomicidad."; }

fingerprint "$WORK/fp_despues.txt"
CAT_DESPUES="$(sha256sum "$WORK/fp_despues.txt" | cut -d' ' -f1)"
if [ "$CAT_ANTES" != "$CAT_DESPUES" ]; then
  echo "sha256 antes=$CAT_ANTES  despues=$CAT_DESPUES" >&2
  echo "--- DIFERENCIAS DEL FINGERPRINT COMPLETO (max 60 líneas) ---" >&2
  diff "$WORK/fp_antes.txt" "$WORK/fp_despues.txt" | sed -n '1,60p' >&2
  die "ATOMICIDAD ROTA: tras el rollback del fallo tardío el estado completo cambió."
fi
diff -q "$WORK/fp_antes.txt" "$WORK/fp_despues.txt" >/dev/null \
  || die "ATOMICIDAD ROTA: el fingerprint difiere pese a coincidir el hash (imposible)."
RESIDUO="$("${PSQL_TEST[@]}" -At -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'p0\_%'")"
[ "$RESIDUO" = "0" ] || die "ATOMICIDAD ROTA: quedaron $RESIDUO funciones p0_* tras el rollback."
echo "ATOMICIDAD PASS  fallo tardío revertido, fingerprint completo idéntico ($CAT_ANTES)"

# --- 5. Aplicación REAL de la cadena en UNA sola transacción ----------
if ! psql -1 -v ON_ERROR_STOP=1 -h "$SOCK" -U "$ROLE" -d "$TESTDB" -q -f "$WORK/chain.sql" >"$WORK/chain.log" 2>&1; then
  sed -n '1,60p' "$WORK/chain.log" >&2
  die "la cadena snapshot->1A.2->1A.3 no aplica en una sola transacción con el rol dedicado."
fi
echo "CADENA PASS  snapshot -> 1A.2 -> 1A.3 aplicada en una única transacción"

"${PSQL_TEST[@]}" -c "DO \$\$
BEGIN
  IF to_regprocedure('public.p0_safe_int(text)') IS NULL
     OR to_regprocedure('public.p0_json_path_resolve(jsonb,text)') IS NULL
     OR to_regprocedure('public.p0_nota_unit_locators(uuid)') IS NULL
     OR to_regprocedure('public.p0_nota_unit_cross_type_unverified(uuid)') IS NULL
     OR to_regprocedure('public.p0_nota_unit_aliases(uuid)') IS NULL
     OR to_regclass('public.v_p0_rights_staging') IS NULL THEN
    RAISE EXCEPTION 'La migración 1A.3 P0.4 no está aplicada en la base de prueba';
  END IF;
END \$\$;" || die "verificación de presencia 1A.3 P0.4 fallida"

# --- 6. Suites: reporte individual, SIN fail-fast ---------------------
for f in "$ROOT/supabase/tests/wave1a3_fixtures.sql" \
         "$ROOT/supabase/tests/wave1a3_readiness_positivo.sql" \
         "$ROOT/supabase/tests/wave1a3_wrapper_idempotencia.sql" \
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
  [ -f "$fichero" ] || { echo "SUITE FAIL  $nombre (fichero ausente)"; FAILED=1; return; }
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
run_suite "readiness_positivo" "$ROOT/supabase/tests/wave1a3_readiness_positivo.sql"
run_suite "wrapper_idempotencia" "$ROOT/supabase/tests/wave1a3_wrapper_idempotencia.sql"
run_suite "vocabulario_identity_match" "$ROOT/supabase/tests/wave1a3_identity_vocab.sql"
run_suite "fuzz_json_path"  "$ROOT/supabase/tests/wave1a3_json_path_fuzz.sql"

if [ "$FAILED" != "0" ]; then
  echo "WAVE 1A.3 P0.4 · integración: NO-GO (al menos un caso en rojo)"
  echo "SENTINEL: WAVE1A3_P04_NO_GO"
  exit 1
fi
echo "WAVE 1A.3 P0.4 · integración: PASS (clúster efímero, base $TESTDB, rol $ROLE, 0 shims, cadena atómica)"
echo "SENTINEL: WAVE1A3_P04_PASS"
