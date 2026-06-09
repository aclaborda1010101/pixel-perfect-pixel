# Plan F1-C-fix1 — Corrección urgente % propiedad

Saneamiento de `pct_propiedad` en UI, scoring, ingesta y datos históricos. Aplica al edificio en preview (`31a46e3a…`) y a toda la cartera.

---

## 1. Función de normalización SQL

Migración: nueva función `public.normalize_pct_propiedad(raw text) RETURNS TABLE(pct numeric, normalizado boolean, invalido boolean, raw_value text)`:

```
- trim + replace(',', '.')
- parse a numeric; si falla → (NULL, false, true, raw)
- v <= 0           → (NULL, false, true, raw)
- v <= 1           → (v*100, true, false, raw)     -- fracción
- v = 100          → (100, false, false, raw)
- 100 < v < 10000  → (v/100, true, false, raw)     -- coma decimal mal parseada
- v > 100 (resto)  → (NULL, false, true, raw)      -- inválido
- 0 < v < 100      → (v, false, false, raw)
```

## 2. Vista `v_owner_score` / RPC `rpc_building_owners_enriched`

- Reemplazar lectura cruda por `normalize_pct_propiedad(...)` aplicada a las 3 fuentes (nota_simple, hubspot_cuota, metadata) en orden COALESCE.
- Exponer columnas: `pct_propiedad numeric NULL`, `pct_normalizado bool`, `pct_invalido bool`, `pct_raw text`, `pct_origen text` (NS|HS|meta|—).
- Recalcular `score_owner_priority`: si `pct_propiedad IS NULL` → **NO** asignar +30 de "<5%"; usar bucket "desconocido" con 0 puntos en ese factor (los demás factores siguen).

## 3. Validación por edificio

En RPC `rpc_building_owners_enriched`, devolver agregado:
- `suma_pct_conocidos numeric`
- `n_pct_desconocidos integer`
- `inconsistencia_pct boolean` = (n_pct_desconocidos=0 AND (suma<95 OR suma>105))

Emitir aviso `pct_inconsistente` en `compute_cluster_score` cuando corresponda (severity=warn, detalle con suma).

## 4. UI (`PropietariosList.tsx`, `EdificioDetalle.tsx`, `BuildingDetail.tsx`, `OwnerDetail.tsx`)

- Render: `pct == null ? '—' : pct.toFixed(1) + '%'`.
- Si `pct_normalizado` → tooltip "Normalizado desde `<raw>`".
- Si `pct_invalido` → badge rojo "% inválido (`<raw>`)".
- Sort ASC: `ORDER BY pct_propiedad ASC NULLS LAST`.
- Banner edificio si `inconsistencia_pct=true`: "Suma de % = X% — revisar nota simple".

## 5. Limpieza retroactiva (insert tool, no migración)

Tres UPDATEs (con CTE `before/after` para log):
- `building_owners.metadatos->>'pct_propiedad'` (HS)
- `nota_simple_titulares.cuota_pct` (NS)
- `owners.metadatos->>'pct_propiedad'` (meta legacy)

Cada uno deja también `metadatos.pct_raw` y `metadatos.pct_normalizado/_invalido` para auditoría.

Devolver `RETURNING` count agregado:
- Total filas tocadas
- Filas con `pct_normalizado=true` (caso coma decimal)
- Filas con `pct_invalido=true` (puestas a NULL)

## 6. Recompute

- Trigger `recompute-all-scores` (existente) para refrescar score con nuevo `score_owner_priority`.
- Refresh materializado de `v_owner_score` si aplica.

## 7. Validación QA

Edificio preview `31a46e3a-5c7e-4144-99e3-8c4cc20b784a` (10 propietarios):
- Owners con `0.0%` raw originados de "—" → ahora `pct=NULL`, render `—`.
- Owner con `515%` → si raw era `51,5` → normalizado a `51.5%` con badge "normalizado"; si era `515` real → `NULL` + badge inválido.
- Verificar `suma_pct` y banner inconsistencia.
- Verificar orden ASC: primero el menor % conocido, NULL al final.

Reporte final:
| Métrica | Valor |
|---|---|
| Registros normalizados (coma decimal) | ? |
| Registros invalidados (→ NULL) | ? |
| Edificios con inconsistencia_pct | ? |
| Score recomputado | 1000/1000 |

---

## Fuera de scope

- Pasos 1-7 del plan F1-C principal (PGOU polígono, patios, HubSpot SL, escaleras XML, viv Serrano 16, admin sub-zonas) — siguen pendientes y se retomarán después de este fix.
- RLS sin cambios.
