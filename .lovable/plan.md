# Plan F1-D — Pasos diferidos F1-B/F1-C

Seis frentes en orden de ejecución. Sin tocar RLS. Cada paso termina con su QA contra la matriz de edificios.

---

## Paso 1 — PGOU por polígono (PRIORITARIO)

**Edge function** `check-proteccion-pgou` (refactor):

1. Leer `parcel_geometry_cache.exterior_ring` (lista de `[lon,lat]`) del `refcatastral_14` del edificio.
2. POST a ArcGIS layer 5 (`EDIFICIOS_PROTEGIDOS/MapServer/5/query`) con:
   - `geometry={"rings":[[...]],"spatialReference":{"wkid":4326}}`
   - `geometryType=esriGeometryPolygon`
   - `spatialRel=esriSpatialRelIntersects`
   - `outFields=N_CATALOGO,NOMBRE,PROTECCION_ACTUAL,PROTECCION_97`
3. Si HIT → `protegido_historicamente=true`, `proteccion_source='pgou_poligono'`.
4. Si MISS o error → fallback **RC14**: query layer por atributo `REFCAT LIKE rc14%`.
5. Si MISS → fallback **fuzzy dirección** contra `madrid_edificios_protegidos.direccion_norm` (trgm similarity ≥ 0.85).
6. Cada intento se acumula en `building_analysis.protegido_raw jsonb` (array de `{intento, payload, hit, ts}`).
7. Si PSM5 detecta PROTECCION_ACTUAL en categoría hospedaje incompatible → emitir aviso `cambio_uso_hospedaje` en `compute_cluster_score`.

**Migración**: añadir `building_analysis.protegido_raw jsonb` si falta; añadir índice trgm sobre `madrid_edificios_protegidos.direccion_norm`.

**Job**: ejecutar para los 77 edificios.

**QA**: Topete 33 → `protegido=true` (pgou_poligono). PSM5 → aviso `cambio_uso_hospedaje`.

---

## Paso 2 — Patios FXCC calibrados

**Constantes en `app_settings`** key=`patio_constants`:
```json
{
  "densidad_ventanas_por_m2_perimetro": {
    "pre_1900": 0.18, "1900_1939": 0.22, "1940_1969": 0.20, "post_1970": 0.18
  },
  "hard_cap_por_vivienda": 4,
  "patio_ingles_area_m2": [4, 9],
  "patio_ingles_perimetro_max": 12
}
```

**Edge function** `count-patio-windows` (refactor):
1. Leer FXCC del PDF parseado (ya existe pipeline).
2. Cruzar polígonos de patio con `interior_ring` de `parcel_geometry_cache` (intersección, no solo bbox).
3. Conteo bruto = perímetro_patio × densidad(época).
4. Clasificar **patio inglés** si área ∈ [4,9] m² y perímetro < 12 m → cuenta como 0 ventanas habitables.
5. Hard-cap: `min(conteo, num_viviendas × 4)`.
6. Persistir en `patio_window_counts` con campos `metodo='fxcc_calibrado_v2'`, `cap_aplicado`, `epoca`.

**QA**: comparar contra muestra del equipo si está disponible; si no, dejar log para recalibración futura.

---

## Paso 3 — HubSpot SL (deals→companies→contacts)

**Edge function** `hubspot_sync_associations` (extender):
1. Tipo asociación `deals→companies` (type 5): poblar `companies` desde el snapshot ya sincronizado.
2. Tipo asociación `companies→contacts` (type 2): insertar/actualizar `owner_companies` con `rol='representante_sociedad'`.
3. Materializar `building_companies` desde `building_owners` + `owner_companies` (un INSERT ... ON CONFLICT por edificio).

**UI**: en `EdificioDetalle.tsx`, nueva tarjeta **"Sociedades propietarias"** debajo de propietarios:
- Lista `building_companies` con nombre, CIF, % agregado, representante (de `owner_companies.rol='representante_sociedad'`).
- La SL cuenta como **1 entidad** en el conteo de proindiviso (ajustar `compute_cluster_score` para no doble-contar contactos asociados a una company ya contada).

**Job**: ejecutar para los 77.

**QA**: Serrano 16 muestra al menos 1 SL con representante.

---

## Paso 4 — Escaleras desde XML DNPRC

**Edge function** nueva `parse-catastro-subparcelas`:
1. GET `OVCCallejero.asmx/Consulta_DNPRC?RC=<rc14>`.
2. Parsear XML, contar `<subparc>` con `<dest>='V'` (residencial) distintas.
3. Persistir `catastro_authority_cache.n_subparcelas_residenciales` (nueva columna).

**Migración**: `ALTER TABLE catastro_authority_cache ADD COLUMN n_subparcelas_residenciales int`.

**`compute_cluster_score`**: `escaleras := GREATEST(n_subparcelas_residenciales, max_vlm, 1)`.

**Job**: ejecutar para los 77.

**QA**: PSM5 → escaleras = 2 (subió de 1).

---

## Paso 5 — Viviendas robustas (Serrano 16)

En `compute_cluster_score` (migración SQL):
```sql
v_viv := CASE
  WHEN v_viv_md IS NULL THEN v_viv_auth
  WHEN v_viv_auth IS NOT NULL
       AND v_m2 / NULLIF(v_viv_md, 0) > 500 THEN v_viv_auth
  ELSE v_viv_md
END;
```
Emitir aviso `viviendas_corregidas` cuando se aplica el fallback.

**QA**: Serrano 16 viv pasa de valor erróneo a 2; score recalculado.

---

## Paso 6 — Sub-zonas (seed + admin)

**Seed inicial** (insert tool, ~30 tramos) en `madrid_calles_subzona` con la heurística del equipo:
- Calles numeradas → `especificidad=10`.
- Calles completas → `especificidad=5`.
- Columnas: `calle, numero_desde, numero_hasta, zona, subzona, especificidad`.

**UI nueva** `/settings/sub-zonas` (admin):
- Tabla CRUD con columnas anteriores.
- Botón "Recomputar afectados" que llama a `recompute-all-scores` filtrado por calle.
- Validación: rangos no se solapan para misma calle.
- Componente `SubZonasPanel.tsx` integrado en `Settings.tsx` solo si `isAdmin`.

**QA**: editar un tramo y verificar que el recompute actualiza score de edificios en ese tramo.

---

## Paso 7 — Recompute global + tabla de validación

1. Ejecutar `recompute-all-scores`.
2. Tabla QA final con los 10 edificios (Topete 33, Serrano 16, Amparo 92, PSM5, Gaztambide 13, Manuela Malasaña 11, + 4 de control), columnas:
   `direccion | score | cluster | rango_tamano | viv | escaleras | protegido | sociedades | avisos`.

---

## Orden de ejecución

```text
Migraciones (protegido_raw, n_subparcelas_residenciales, viviendas fix, app_settings seed)
  → edge functions (check-proteccion-pgou, count-patio-windows, hubspot_sync_associations, parse-catastro-subparcelas)
  → UI (tarjeta Sociedades, SubZonasPanel)
  → jobs (subparcelas×77, hubspot×77, pgou×77, patios×77, recompute global)
  → QA matrix
```

## Fuera de scope

- RLS sin cambios.
- Recalibración fina de constantes de patios (queda pendiente de los conteos reales del equipo).
- Auto-confirm email / OAuth changes.
