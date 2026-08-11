#!/usr/bin/env bash
# =====================================================================
# WAVE 1A.3 P0.4 · GENERADOR REPRODUCIBLE DEL SNAPSHOT PRE-1A.2
# =====================================================================
# Reconstruye, en un clúster efímero propio, el esquema EXACTO anterior
# a 1A.2 a partir del material versionado del repositorio:
#   1. supabase/tests/wave1a_local_baseline.sql  (prólogo de plataforma)
#   2. todas las supabase/migrations/*.sql con timestamp < 20260810164500
# y vuelca el resultado con pg_dump --schema-only.
#
# Post-proceso DETERMINISTA (documentado, sin alterar semántica):
#   - se eliminan las meta-órdenes \restrict / \unrestrict (token aleatorio
#     por volcado: romperían la reproducibilidad del SHA256);
#   - se extraen las órdenes CREATE EXTENSION / COMMENT ON EXTENSION a un
#     fichero hermano .extensions, porque las extensiones son REALES y las
#     instala el superusuario del clúster antes de la cadena;
#   - se excluyen los esquemas net y cron: los aportan pg_net y pg_cron.
#
# Salidas versionadas:
#   wave1a3_snapshot_pre_1a2.sql[.extensions|.sha256|.provenance]
#
# Requiere PostgreSQL 17 con pg_cron, pg_net y vector reales. Nunca toca
# ninguna base que no sea su propio clúster desechable.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CUT="20260810164500"
OUT="$HERE/wave1a3_snapshot_pre_1a2.sql"

for v in DATABASE_URL SUPABASE_DB_URL PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD; do
  [ -n "${!v:-}" ] && { echo "ABORTADO: $v definida; el generador sólo usa su clúster efímero." >&2; exit 2; }
done
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

W="$(mktemp -d "${TMPDIR:-/tmp}/wave1a3snap.XXXXXX")"; mkdir -p "$W/sock"
trap 'pg_ctl -D "$W/data" -m immediate stop >/dev/null 2>&1; rm -rf "$W"' EXIT
DB="wave1a_test_snapgen"

initdb -D "$W/data" -U snapadm -A trust --no-locale --encoding=UTF8 >"$W/initdb.log" 2>&1 || { tail -20 "$W/initdb.log" >&2; exit 1; }
pg_ctl -D "$W/data" -w -l "$W/pg.log" \
  -o "-c listen_addresses='' -k '$W/sock' -c fsync=off -c shared_preload_libraries='pg_cron,pg_net' -c cron.database_name=$DB" \
  start >/dev/null 2>&1 || { tail -30 "$W/pg.log" >&2; exit 1; }

PA=(psql -v ON_ERROR_STOP=1 -h "$W/sock" -U snapadm -q)
"${PA[@]}" -d postgres -c "CREATE DATABASE $DB" || exit 1
for e in pgcrypto '"uuid-ossp"' pg_trgm vector pg_cron pg_net fuzzystrmatch; do
  "${PA[@]}" -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS $e CASCADE;" >/dev/null || exit 1
done

"${PA[@]}" -d "$DB" -f "$HERE/wave1a_local_baseline.sql" >"$W/base.log" 2>&1 \
  || { tail -20 "$W/base.log" >&2; echo "ABORTADO: el prólogo de plataforma no aplica." >&2; exit 1; }

: > "$W/skipped.txt"; APPLIED=0
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  b="$(basename "$f")"; [ "${b:0:14}" \< "$CUT" ] || continue
  if "${PA[@]}" -d "$DB" -f "$f" >"$W/m.log" 2>&1; then
    APPLIED=$((APPLIED+1))
  else
    echo "$b :: $(grep -m1 -i '^psql:.*ERROR' "$W/m.log" | sed 's/^psql:[^ ]* //')" >> "$W/skipped.txt"
  fi
done

# Roles de plataforma: son GLOBALES del clúster y por eso no viajan en
# pg_dump. Se vuelcan aparte, sin contraseñas, para que el runner los
# recree con el superusuario antes de aplicar la cadena.
{
  echo "-- Roles de plataforma del snapshot pre-1A.2 (globales del clúster)."
  pg_dumpall -h "$W/sock" -U snapadm --roles-only --no-role-passwords \
    | sed -n 's/^CREATE ROLE \(anon\|authenticated\|service_role\|supabase_auth_admin\|authenticator\);$/\1/p' \
    | sort -u \
    | while IFS= read -r rol; do
        echo "DO \$r\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$rol') THEN CREATE ROLE \"$rol\"; END IF; END \$r\$;"
      done
} > "$OUT.roles"

pg_dump -h "$W/sock" -U snapadm -d "$DB" --schema-only --no-owner --no-privileges \
  --exclude-schema=net --exclude-schema=cron -f "$W/raw.sql" || exit 1

grep -E '^(CREATE EXTENSION|COMMENT ON EXTENSION)' "$W/raw.sql" > "$OUT.extensions"
{
  cat <<'HDR'
-- =====================================================================
-- WAVE 1A.3 P0.4 · SNAPSHOT VERSIONADO DEL ESQUEMA PRE-1A.2
-- =====================================================================
-- GENERADO, NO ESCRITO A MANO. Reproducir con wave1a3_make_snapshot.sh.
-- Procedencia y checksum en los ficheros hermanos .provenance y .sha256.
-- Las extensiones REALES viven en el fichero hermano .extensions y las
-- instala el superusuario del clúster antes de aplicar la cadena.
-- NUNCA debe ejecutarse contra una base real.
-- =====================================================================
DO $snapguard$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: snapshot pre-1A.2 solo en base desechable wave1a_test_*, base actual = %', current_database();
  END IF;
END $snapguard$;
HDR
  grep -vE '^(\\restrict|\\unrestrict|CREATE EXTENSION|COMMENT ON EXTENSION)' "$W/raw.sql"
} > "$OUT"

( cd "$HERE" && sha256sum "$(basename "$OUT")" "$(basename "$OUT").extensions" "$(basename "$OUT").roles" > "$(basename "$OUT").sha256" )

COMMIT="$(cd "$ROOT" && git rev-parse HEAD 2>/dev/null || echo desconocido)"
{
  echo "generador=supabase/tests/wave1a3_make_snapshot.sh"
  echo "commit=$COMMIT"
  echo "postgres=$(psql --version | awk '{print $3}')"
  echo "corte=migraciones versionadas con timestamp < $CUT"
  echo "prologo=supabase/tests/wave1a_local_baseline.sql"
  echo "migraciones_aplicadas=$APPLIED"
  echo "migraciones_no_aplicables=$(wc -l < "$W/skipped.txt" | tr -d ' ')"
  echo "extensiones_reales=pgcrypto,uuid-ossp,pg_trgm,vector,pg_cron,pg_net,fuzzystrmatch"
  echo "esquemas_excluidos=net,cron (los aportan pg_net y pg_cron)"
  echo "--- migraciones no aplicables (deriva de baseline declarada) ---"
  cat "$W/skipped.txt"
} > "$OUT.provenance"

echo "SNAPSHOT OK  aplicadas=$APPLIED  no_aplicables=$(wc -l < "$W/skipped.txt" | tr -d ' ')"
cat "$OUT.sha256"
