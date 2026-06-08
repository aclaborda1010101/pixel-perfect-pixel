## Objetivo
Arreglar el conteo de fachada en edificios cuyo footprint de OSM es un fragmento (caso Topete 33) y dejar de depender del VLM para saber si un edificio hace esquina. La geometría manda; el VLM cuenta ejes sobre fachadas que ya sabemos dónde están.

## Cambios

### 1. Nueva fuente autoritativa: INSPIRE Catastral Parcels (`_shared/parcel_geometry.ts`)
Añadir `source: 'catastro_parcel'` como fuente PRIMARIA. Servicio WFS INSPIRE de la Dirección General del Catastro: `https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx`, FeatureType `cp:CadastralParcel`.

- **Consulta por refcatastral (14):** `GetFeature` con filtro `cp:nationalCadastralReference = {rc14}`, output GML 3.2.1.
- **Consulta por coordenadas (fallback INSPIRE):** `GetFeature` con `BBOX` 30 m alrededor del centroide, EPSG:4326; del FeatureCollection devuelto, escoger la parcela cuyo polígono contiene el punto.
- Parsear `gml:Polygon` → `exterior_ring` + `interior_rings` (patios catastrados aparecen como `gml:interior`).
- Cachear igual que los demás (`source='catastro_parcel'`, `confidence='alta'` cuando coincide rc14).
- Retry 2 veces con backoff 800 ms / 2 s; timeout 20 s. Si falla → siguiente origen.

### 2. Orden de orígenes en `fetchParcelGeometry`
```text
1) catastro_parcel  (INSPIRE WFS-CP, por rc14)
2) catastro_parcel  (INSPIRE WFS-CP, por bbox/coords)
3) overpass_ref
4) overpass_bbox
5) wfs_inspire   (el WFS-INSPIRE Buildings actual, fallback histórico)
6) fallback_geometrico (sqrt(area_catastro))
```
Cada origen pasa por la misma **validación de área contra catastro authority** definida en (3). Se devuelve el primer candidato que pase. Si ninguno pasa, se devuelve el menos malo con `confidence='baja'` y flag `polygon_no_fiable`.

### 3. Validación de polígono contra catastro
Tras cada candidato, comparar `area_m2` con `superficie_parcela_m2` del catastro authority (nuevo parámetro `expected_area_m2`):
- Si `area < 0.5 * expected` o `|area - expected| / expected > 0.4` → descartar, flag `polygon_area_mismatch_catastro`, intentar siguiente origen.
- Si todos fallan → devolver el de mayor área (más cercano) con `confidence='baja'` y `polygon_no_fiable`.
- Cachear igualmente con `flags` para no martillear orígenes.

### 4. Detección geométrica de esquina (`_shared/parcel_geometry.ts`)
Nueva función exportada `detectStreetEdges(ring, opts)` que devuelve `{ street_edges, is_corner, total_street_length_m, corner_angle_deg }`:
1. Para cada arista del anillo exterior, lanzar 3 ray-casts cortos (8 m) hacia su normal exterior.
2. Clasificar arista como "a calle" si Overpass devuelve un `way[highway~"^(primary|secondary|tertiary|residential|living_street|pedestrian|unclassified)$"]` a ≤8 m en al menos 2 de los 3 ray-casts, y no hay otro `building=*` interpuesto.
3. Una sola query Overpass por edificio con bbox del polígono + 20 m, filtrar las vías cacheadas en memoria del request.
4. `is_corner = true` ⇔ ≥2 aristas a calle con ángulo entre sus bearings en [60°, 120°].
5. `total_street_length_m = Σ longitudes de aristas a calle`.

Cachear en columna nueva `street_edges_jsonb` de `parcel_geometry_cache`.

### 5. Refactor `count-facade-windows/index.ts`
- Llamar `fetchParcelGeometry` pasando `expected_area_m2` del catastro authority.
- Si la geometría es fiable (`confidence != 'baja'` y sin `polygon_no_fiable`), invocar `detectStreetEdges`.
- Ordenar street_edges por longitud descendente:
  - `fachada_principal` = arista más larga.
  - `fachada_secundaria` = siguiente arista a calle si `is_corner=true` y ángulo en [60°, 120°] respecto a la principal.
- Calcular `heading` y 3 capturas Street View **por fachada** (principal + secundaria si existe). Hasta 6 imágenes.
- VLM prompt modificado: pide ejes para `fachada_principal` y `fachada_secundaria` por separado; devuelve `{ejes_principal, ejes_secundaria, ...}`. Quitar `edificio_hace_esquina` del prompt.
- Fórmula nueva:
  ```text
  ejes_total = ejes_principal + ejes_secundaria
  vtt = ejes_total * plantas_tipo
  vbp = hayPortal ? ejes_total - 1 : ejes_total
  ven = has_entresuelo ? ejes_total - 1 : 0
  total = vtt + vbp + ven
  longitud_fachada_total_m = suma de aristas a calle
  ```
- Si geometría no fiable → fallback actual (1 arista, VLM cuenta lo que ve) + flag `esquina_no_detectable_por_geometria`.

### 6. Persistencia (`facade_window_counts`) — migración
- `es_esquina BOOLEAN`
- `esquina_source TEXT` (`geometria` | `vlm_fallback` | `desconocido`)
- `fachadas_a_calle JSONB` (array `[{bearing, len, heading, street_name?}]`)
- `longitud_fachada_total_m NUMERIC`
- `longitud_fachada_m` se mantiene = longitud de la principal (compat UI).
- Reusar `fachada_secundaria` (ya nullable) para los ejes de la secundaria.

### 7. UI (`/comercial/edificios/:id`)
- Campo "ESQUINA" lee `facade_window_counts.es_esquina` (no `vlm_parsed.edificio_hace_esquina`).
- Mostrar `longitud_fachada_total_m` con tooltip "suma de fachadas a calle".

### 8. Validación
- **Topete 33** (rc14 `0382201VK4708C0001IZ`, 2369 m²): esperar que `catastro_parcel` por rc14 devuelva el polígono real (~2300-2400 m²) → pasa validación → `detectStreetEdges` detecta esquina (Topete × calle perpendicular) → `es_esquina=true`, `total_street_length_m` ≈ 30-40 m → VLM cuenta ejes en 2 fachadas → total realista.
- **Díaz Porlier 47** (rc14 `2658209VK4725H0001UM`, ~933 m² en Overpass): catastro_parcel valida o, si discrepa, overpass_bbox pasa. `es_esquina=false`.
- 5 edificios más de cartera para medir cobertura real de `catastro_parcel` y cuántos polígonos pasan validación.

## Orden de implementación
1. Migración SQL (`parcel_geometry_cache.street_edges_jsonb`, columnas nuevas en `facade_window_counts`).
2. `_shared/parcel_geometry.ts`: fuente `catastro_parcel` (rc14 + bbox), validación de área, `detectStreetEdges`.
3. `count-facade-windows/index.ts`: nuevo flujo principal+secundaria, prompt VLM, fórmula, persistencia.
4. UI: campo ESQUINA y longitud total.
5. Pruebas contra Topete 33 y Díaz Porlier 47.

## Fuera de alcance
- `count-patio-windows`: no se toca en este paso (aunque se beneficiará automáticamente del polígono catastral con patios reales).
- Recompute masivo del scoring: tras validar 10-15 edificios manualmente.
- Sub-zonificación Salamanca/Chamberí: pendiente, sin relación con este cambio.
