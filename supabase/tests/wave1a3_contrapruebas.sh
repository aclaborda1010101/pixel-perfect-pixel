#!/usr/bin/env bash
# =====================================================================
# WAVE 1A.3 P0.6 · CONTRAPRUEBAS DEL LABORATORIO
# =====================================================================
# Demuestra que el sentinel del runner NO puede ponerse verde con material
# maquillado. Cada contraprueba introduce UNA trampa y exige que el runner
# termine en NO-GO o NO_VERIFICADO (nunca WAVE1A3_P04_PASS):
#   C1  shim: reaparece wave1a_baseline_drift.sql
#   C2  placeholder: fila BASELINE LOCAL PLACEHOLDER en el snapshot
#   C3  stub de plataforma: cron.schedule / net.http_post inventados
#   C4  migración omitida en la procedencia
#   C5  procedencia editada a mano (commit falso / omitidas>0)
#   C6  checksum del snapshot alterado
#   C7  JSON extra en el wrapper (reason/motivo) -> suite en rojo
# Los artefactos se restauran siempre (trap). Cero DB live, cero deploy.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RUNNER="$HERE/wave1a3_integration_runner.sh"
SNAP="$HERE/wave1a3_snapshot_pre_1a2.sql"
FWD="$ROOT/supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql"
BACK="$(mktemp -d)"
FALLOS=0

restore() {
  for f in "$SNAP" "$SNAP.provenance" "$SNAP.sha256" "$FWD"; do
    [ -f "$BACK/$(basename "$f")" ] && cp "$BACK/$(basename "$f")" "$f"
  done
  rm -f "$HERE/wave1a_baseline_drift.sql"
  rm -rf "$BACK"
}
trap restore EXIT
for f in "$SNAP" "$SNAP.provenance" "$SNAP.sha256" "$FWD"; do
  [ -f "$f" ] && cp "$f" "$BACK/$(basename "$f")"
done

correr() {  # imprime el sentinel del runner
  ( cd "$ROOT" && env -u SUPABASE_DB_URL -u PGHOST -u PGPORT -u PGUSER \
      -u PGPASSWORD -u PGDATABASE bash "$RUNNER" 2>&1 ) | grep -oE 'SENTINEL: [A-Z0-9_]+' | tail -1
}

exige_no_pass() {  # $1 = nombre de la contraprueba
  local s; s="$(correr)"
  if [ "$s" = "SENTINEL: WAVE1A3_P04_PASS" ]; then
    echo "CONTRAPRUEBA FALLA  $1 -> el sentinel se puso VERDE con material maquillado"; FALLOS=1
  else
    echo "CONTRAPRUEBA OK     $1 -> $s"
  fi
  restore_parcial
}
restore_parcial() {
  for f in "$SNAP" "$SNAP.provenance" "$SNAP.sha256" "$FWD"; do
    [ -f "$BACK/$(basename "$f")" ] && cp "$BACK/$(basename "$f")" "$f"
  done
  rm -f "$HERE/wave1a_baseline_drift.sql"
}

# C1 · shim reintroducido
printf -- '-- shim\nSELECT 1;\n' > "$HERE/wave1a_baseline_drift.sql"
exige_no_pass "C1 shim wave1a_baseline_drift.sql"

# C2 · placeholder dentro del snapshot
if [ -f "$SNAP" ]; then
  printf -- "\nINSERT INTO public.buildings (id, direccion) VALUES (gen_random_uuid(), 'BASELINE LOCAL PLACEHOLDER');\n" >> "$SNAP"
  exige_no_pass "C2 placeholder en el snapshot"
else
  echo "CONTRAPRUEBA N/A    C2 (no hay snapshot: el runner ya está en NO_VERIFICADO)"
fi

# C3 · stubs de plataforma
if [ -f "$SNAP" ]; then
  printf -- "\nCREATE OR REPLACE FUNCTION cron.schedule(a text, b text, c text) RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint';\n" >> "$SNAP"
  exige_no_pass "C3 stub cron.schedule"
else
  echo "CONTRAPRUEBA N/A    C3 (no hay snapshot)"
fi

# C4 · migración omitida en la procedencia
if [ -f "$SNAP.provenance" ]; then
  sed -i '$d' "$SNAP.provenance"
  ( cd "$HERE" && sha256sum "$(basename "$SNAP")" "$(basename "$SNAP").extensions" \
      "$(basename "$SNAP").roles" "$(basename "$SNAP").provenance" > "$(basename "$SNAP").sha256" )
  exige_no_pass "C4 migración omitida en la procedencia"
else
  echo "CONTRAPRUEBA N/A    C4 (no hay procedencia)"
fi

# C5 · procedencia editada (commit falso y omitidas>0)
if [ -f "$SNAP.provenance" ]; then
  sed -i 's/^commit=.*/commit=desconocido/; s/^migraciones_no_aplicables=.*/migraciones_no_aplicables=11/' "$SNAP.provenance"
  ( cd "$HERE" && sha256sum "$(basename "$SNAP")" "$(basename "$SNAP").extensions" \
      "$(basename "$SNAP").roles" "$(basename "$SNAP").provenance" > "$(basename "$SNAP").sha256" )
  exige_no_pass "C5 procedencia editada (commit/omitidas)"
else
  echo "CONTRAPRUEBA N/A    C5 (no hay procedencia)"
fi

# C6 · checksum alterado
if [ -f "$SNAP.sha256" ]; then
  sed -i '1s/^[0-9a-f]\{4\}/dead/' "$SNAP.sha256"
  exige_no_pass "C6 checksum del snapshot alterado"
else
  echo "CONTRAPRUEBA N/A    C6 (no hay checksum)"
fi

# C7 · el wrapper vuelve a añadir reason/motivo
python3 - "$FWD" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = "  RETURN public.p0_property_rights_dry_run();"
new = ("  RETURN public.p0_property_rights_dry_run()\n"
       "         || jsonb_build_object('reason', p_reason, 'motivo', 'contraprueba');")
if old in s:
    open(p, 'w').write(s.replace(old, new, 1))
    print("C7 inyectado")
else:
    print("C7 NO inyectado: el wrapper ya no devuelve el dry-run puro")
PY
exige_no_pass "C7 JSON extra (reason/motivo) en el wrapper"

if [ "$FALLOS" != "0" ]; then
  echo "CONTRAPRUEBAS: NO-GO (alguna trampa pasó el sentinel)"
  echo "SENTINEL: WAVE1A3_CONTRAPRUEBAS_NO_GO"
  exit 1
fi
echo "CONTRAPRUEBAS: PASS (ninguna trampa consigue el sentinel verde)"
echo "SENTINEL: WAVE1A3_CONTRAPRUEBAS_PASS"
