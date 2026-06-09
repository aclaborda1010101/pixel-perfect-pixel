
# Bloque F1-B — Plan de ejecución

Cierre de F1-A pendiente + 7 frentes de datos/UI. Sin tocar RLS. Orden pensado para validar en 3 edificios antes de cada recompute.

---

## Paso 0 · Cierre F1-A

1. **Migración SQL**
   - `ALTER TABLE building_owners ADD CONSTRAINT building_owners_unique_by_name UNIQUE (building_id, normalize_person_name(nombre))` — antes, dedupe in-place de filas existentes en una CTE y `DELETE` de las duplicadas (conservar la de `pct_propiedad` mayor o `updated_at` más reciente).
   - Si la unicidad por nombre rompe casos legítimos (homónimos con NIF distinto), caer a índice **parcial** condicional `WHERE normalize_person_name(nombre) IS NOT NULL`.
2. **RuntimeErrorBoundary** en `/comercial/edificios/:id`
   - Nuevo `src/components/RuntimeErrorBoundary.tsx` (class component con `componentDidCatch` + `getDerivedStateFromError`).
   - Wrap en `EdificioDetalle.tsx` y `BuildingDetail.tsx`. UI fallback con botón "Recargar" y enlace a la cartera.
3. **Recompute global** al final del bloque (no ahora): edge function `recompute-all-scores` que itere `buildings.id` en lotes de 200 con `compute_cluster_score`.

## Paso 1 · % de propiedad por propietario (petición nueva)

**Fuentes y COALESCE:** `nota_simple_titulares.porcentaje` (autoritativo) → `building_owners.pct_propiedad` (HubSpot) → `owners.metadatos->>'pct_propiedad'`. Persistir origen para mostrarlo.

1. **RPC** `rpc_building_owners_enriched(p_building_id uuid)` SECURITY DEFINER que devuelva por owner: `nombre, email, telefono, pct_propiedad, pct_origen (`nota_simple`|`hubspot`|`metadata`|`desconocido`), contactos_previos, interes, nif, score_propietario`.
2. **Scoring de propietarios** — añadir a la función existente (o nueva `score_owner_priority`) un factor inverso al `pct_propiedad`:
   - `pct < 5%` → +30 pts (target prioritario, fácil firma)
   - `5–15%` → +20
   - `15–33%` → +10
   - `>33%` → 0
3. **UI** — en `EdificioDetalle.tsx`, `BuildingDetail.tsx`, `OwnerDetail.tsx`:
   - Columna **% Prop.** con badge de origen (`NS`/`HS`/`meta`/`?`) en tooltip.
   - Orden por defecto: `pct_propiedad ASC NULLS LAST` (los más interesantes arriba). Toggle para volver a orden por score/contactos.
   - Si suma `< 95%` o `> 105%` mostrar warning "datos incompletos/inconsistentes".

## Paso 2 · §2.1 Ventanas a patio calibradas

Edge function `count-patio-windows/index.ts`:

1. **Intersección FXCC** — pedir a `parcel_geometry_cache.fxcc_housing_footprints` (jsonb) las huellas de viviendas. Para cada arista del `interior_ring`, contar SOLO ventanas si su segmento está a ≤ `BUFFER_M` (1.5m) de una huella FXCC.
2. **Fallback sin FXCC** — `factorUso = ageFactor[epoca]` (0.35 pre-1900, 0.5 1900-1940, 0.65 1940-1980, 0.8 post-1980), parametrizado en `app_settings.patio_age_factor`.
3. **Hard cap** — `estimacion_total = LEAST(estimacion_total, num_viviendas * 4)`.
4. **Patio inglés / patinillo** — si `area_m2 < 4` o `perimetro_m < 8` → 0 ventanas (ya hecho). Añadir `tipo='patio_ingles'` cuando `4 ≤ area ≤ 9` o `perimetro < 12` → 0 ventanas y motivo en `.raw`.
5. **Recalibrar `densidadPorAno`** contra los 11 edificios del feedback QA: ajustar constantes hasta error medio < 20%; documentar tabla en el header del archivo.
6. **Validar en 3 edificios** (Topete 33, Gaztambide 13, Sanz Raso 18) y dar diff antes/después antes de tocar más.

## Paso 3 · §2.2 Protección PGOU por polígono

Edge function `check-proteccion-pgou/index.ts`:

1. **Polígono exterior** — leer `parcel_geometry_cache.exterior_ring` (GeoJSON Polygon) y enviarlo a ArcGIS como `geometryType=esriGeometryPolygon` con `spatialRel=esriSpatialRelIntersects`. Reemplaza el envío puntual por centroide.
2. **Fallback 1 (RC14)** — consultar capa con `where=REFCAT='<RC14>'`.
3. **Fallback 2 (fuzzy dirección)** — `madrid_edificios_protegidos` con `similarity(direccion_norm, b.direccion_norm) > 0.4`, ordenar DESC.
4. **Persistencia** — `building_analysis.protegido_historicamente`, `protegido_nivel`, y `protegido_raw` (jsonb con `{attempt, source, response_count, matched_at}` para cada intento).
5. **Verificación** — invocar para Topete 33 y confirmar `protegido_historicamente=true`. Si sigue false, inspeccionar respuesta ArcGIS y abrir nota en `building_analysis.notas_admin`.

## Paso 4 · §2.6 m² robustos (Serrano 16)

En `compute_cluster_score`:

```text
v_m2_meta := metadata->>'metros_cuadrados__exactos_'
v_m2_auth := catastro_authority_cache.metros_cuadrados_construidos
v_m2 := CASE
  WHEN v_m2_auth IS NOT NULL AND (v_m2_meta IS NULL OR v_m2_meta < v_m2_auth * 0.10)
    THEN v_m2_auth          -- sanity-check: metadata corrupta
  ELSE COALESCE(v_m2_meta, v_m2_auth)
END
```

Persistir `m2_fuente` en `cluster_breakdown` para auditoría. Verificación: Serrano 16 debe usar authority y subir de 24 a ~50-65 (ultra_prime + cambio de uso terciario con m² real).

## Paso 5 · §2.8 Sub-zonificación con tramos

1. **Schema** `madrid_calles_subzona` — añadir `numero_desde int`, `numero_hasta int`, `especificidad int` (3=tramo, 2=calle entera, 1=zona).
2. **Migración de datos** — script de carga con los tramos faltantes (Gaztambide, Porvenir, Esparteros, Manuela Malasaña, etc.). El script saldrá como tarea de "Add data" en la insert tool.
3. **Lookup** en `compute_cluster_score` — `WHERE calle_norm = v_calle_exact AND (numero IS NULL OR <building_num> BETWEEN numero_desde AND numero_hasta) ORDER BY especificidad DESC LIMIT 1`. Extraer `<building_num>` de `b.direccion` con regexp.
4. **Flag `apto_reposicionamiento_2a_mano`** — cuando `ratio BETWEEN 60 AND 90`, emitir aviso `medium` paralelo.
5. **Endurecer flex_living_core** — `ratio < 70` o `densidad > X viv/m²` → `cluster_secundario='reposicionamiento_2a_mano'` y `w_ratio` sube a 35.
6. **Verificación** en 4 edificios listados.

## Paso 6 · §2.9 HubSpot SL completo

1. **Edge function** `hubspot_sync_associations/index.ts` — extender:
   - `deals → companies` (`/crm/v4/associations/deals/companies/batch/read`)
   - `companies → contacts` con label `administrator` o `representative` → insertar como `building_owners` con `rol='representante_sociedad'`, `pct_propiedad` heredado de la company.
2. **Materializar** `building_companies` (insert/update por `(building_id, hubspot_company_id)`).
3. **Conteo proindiviso** — `count_distinct_owners` ya cuenta personas. Ajustar: una SL en `building_companies` cuenta como **1 entidad** y sus representantes NO suman al conteo (filtro `WHERE rol IS DISTINCT FROM 'representante_sociedad'`).
4. **UI** — tarjeta nueva `<SociedadesPropietarias>` en `EdificioDetalle.tsx` debajo de propietarios: nombre SL, CIF, % propiedad agregado, representantes (chips).
5. **Verificación** — Serrano 16 debe mostrar al menos 1 SL y conteo proindiviso coherente.

## Paso 7 · Escaleras Plaza San Miguel 5

1. Comprobar `building_analysis.n_escaleras_en_piso01` y subparcelas en `catastro_authority_cache.subparcelas_distinct`.
2. La fórmula `GREATEST(VLM, planta_baja, segundas_escaleras*2)` ya existe; falta sumar el `DISTINCT subparcela` del authority cache. Patch a `compute_cluster_score` (línea de `v_n_escaleras := GREATEST(...)`) añadiendo el COUNT DISTINCT.
3. Verificar que devuelve 2 y dispara `cambio_uso_hospedaje` (PSM5 está protegido).

## Paso 8 · Recompute global + matriz QA

1. Crear edge function `recompute-all-scores` (lotes de 200 con backoff). Lanzar tras validar pasos 2–7.
2. **Tabla QA final** con los 10 edificios de la matriz: `direccion, m2_fuente, cluster, score_antes, score_despues, n_escaleras, protegido, owners_dedup, sl_count, ventanas_patio, avisos`.

---

## Detalles técnicos (resumen)

| Archivo | Cambio |
|---|---|
| migración SQL #1 | Dedupe + UNIQUE en `building_owners`; `m2_fuente` en breakdown; sub_zona con tramos; sanity check m² |
| migración SQL #2 | `rpc_building_owners_enriched`, `score_owner_priority`, ajustes `compute_cluster_score` (m², escaleras, sub_zona, SL counting) |
| `supabase/functions/count-patio-windows/index.ts` | FXCC + ageFactor + cap + patio_ingles + recalibración |
| `supabase/functions/check-proteccion-pgou/index.ts` | Polígono + RC14 + fuzzy + raw |
| `supabase/functions/hubspot_sync_associations/index.ts` | deals→companies, companies→contacts |
| `supabase/functions/recompute-all-scores/index.ts` | Lotes 200, backoff |
| `src/components/RuntimeErrorBoundary.tsx` | Nuevo |
| `src/components/comercial/PropietariosList.tsx` | Columna % + origen + sort |
| `src/components/comercial/SociedadesPropietarias.tsx` | Nueva tarjeta |
| `src/pages/comercial/EdificioDetalle.tsx`, `BuildingDetail.tsx`, `OwnerDetail.tsx` | Integración % propiedad, ErrorBoundary, tarjeta SL |
| Insert tool | Carga inicial de tramos en `madrid_calles_subzona` |

## Orden de validación (NO recompute hasta el final)

1. Paso 0 (constraint + boundary) → smoke test rutas.
2. Paso 4 (m²) → validar Serrano 16.
3. Paso 7 (escaleras) → validar PSM5.
4. Paso 5 (sub-zonas) → validar 4 edificios listados.
5. Paso 1 (% propiedad UI) → validar visual en 3 edificios.
6. Paso 2 (patios) → validar 3 edificios + recalibración.
7. Paso 3 (PGOU) → validar Topete 33.
8. Paso 6 (HubSpot SL) → validar Serrano 16.
9. Paso 8 → recompute global y entregar tabla QA.

**Paro al final del Paso 8 y antes de tocar ITE.**
