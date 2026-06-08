
# Fase A1 — `fetch-parcel-geometry` (Overpass primario, WFS-INSPIRE fallback)

## Estrategia Overpass

OSM tagea edificios de España con `ref:catastral=<RC14>` sobre `way` o `relation` con `building=*`. Cobertura en Madrid centro ≈ 85-95% para edificios catastrados. Para los huecos usamos búsqueda geoespacial por bbox alrededor del centroide.

**Query primaria — por referencia catastral (14 chars):**
```overpassql
[out:json][timeout:25];
(
  way["ref:catastral"="{rc14}"];
  relation["ref:catastral"="{rc14}"];
);
out geom;
```

**Query fallback geoespacial — por lat/lng del centroide (radio 30 m):**
```overpassql
[out:json][timeout:25];
(
  way(around:30,{lat},{lon})["building"];
  relation(around:30,{lat},{lon})["building"];
);
out geom;
```
Luego seleccionamos el polígono que **contiene el punto** (ray casting); si ninguno lo contiene, el más cercano dentro de 8 m.

**Endpoint con failover** (round-robin con retry):
1. `https://overpass-api.de/api/interpreter`
2. `https://overpass.kumi.systems/api/interpreter`
3. `https://overpass.private.coffee/api/interpreter`

Backoff exponencial 500ms → 1.5s → 4s. Timeout HTTP 20 s. Si los 3 endpoints fallan o devuelven 429/504 → pasa a WFS-INSPIRE.

## Plan técnico

### 1. Migración SQL — `parcel_geometry_cache`

```sql
create table public.parcel_geometry_cache (
  id uuid primary key default gen_random_uuid(),
  refcatastral_14 text unique not null,
  exterior_ring jsonb not null,           -- [[lon,lat], ...]
  interior_rings jsonb not null default '[]'::jsonb, -- [[[lon,lat],...], ...] patios
  bbox jsonb not null,                    -- {minLon,minLat,maxLon,maxLat}
  centroid jsonb not null,                -- {lat, lon}
  area_m2 numeric,
  perimeter_m numeric,
  source text not null,                   -- 'overpass_ref' | 'overpass_bbox' | 'wfs_inspire' | 'fallback'
  confidence text not null,               -- 'alta' | 'media' | 'baja'
  osm_id bigint,
  osm_type text,                          -- 'way' | 'relation'
  flags text[] not null default '{}',
  raw_response jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days')
);
-- GRANT SELECT authenticated; GRANT ALL service_role; RLS SELECT authenticated, escritura solo service_role.
-- Index on (refcatastral_14), (expires_at).
```

TTL: 180 días (los polígonos catastrales cambian raras veces). `force=true` ignora caché y refetch.

### 2. Módulo compartido `supabase/functions/_shared/parcel_geometry.ts`

API pública única:
```ts
export interface ParcelGeometry {
  exterior_ring: [number, number][];       // [lon, lat]
  interior_rings: [number, number][][];    // patios
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  centroid: { lat: number; lon: number };
  area_m2: number;
  perimeter_m: number;
  source: 'overpass_ref' | 'overpass_bbox' | 'wfs_inspire' | 'fallback';
  confidence: 'alta' | 'media' | 'baja';
  flags: string[];
  osm_id?: number;
  osm_type?: 'way' | 'relation';
  cached: boolean;
}

export async function fetchParcelGeometry(opts: {
  refcatastral_14: string;
  lat?: number;
  lon?: number;
  force?: boolean;
  sbAdmin: SupabaseClient;
}): Promise<ParcelGeometry>;
```

**Flujo interno:**
1. Si `!force` → lookup `parcel_geometry_cache` por rc14 y `expires_at > now()`. Si hit → devolver con `cached: true`.
2. **Overpass por rc14** (con failover de endpoints + retry). Si hay match → confianza `alta`, source `overpass_ref`.
3. Si no hay match y hay coords → **Overpass por bbox** alrededor del centroide. Pick polygon containing point (o más cercano ≤8 m). Confianza `media`, source `overpass_bbox`, flag `geometry_via_bbox`.
4. Si Overpass falla → **WFS-INSPIRE** (la lógica existente que ya tiene `count-facade-windows`). Confianza `media`, source `wfs_inspire`.
5. Si WFS también falla → **fallback geométrico**: cuadrado equivalente desde `area_construida / plantas`. Confianza `baja`, source `fallback`, flag `geometry_fallback_estimado`.
6. Persistir en caché (upsert por rc14).

**Cálculos geométricos compartidos:**
- `polygonAreaM2(ring)` (shoelace + corrección esférica equirectangular para Madrid).
- `polygonPerimeterM(ring)` (haversine por aristas).
- `pointInPolygon(pt, ring)` (ray casting).
- `polygonContainsHoles(outer, holes)` para identificar patios desde relations multipolygon.
- `bboxOf(ring)`.

**Detección de patios desde Overpass:** las relations multipolygon con `building=*` ya traen miembros con role `inner` → los mapeamos directamente a `interior_rings`. Esto es **bonus crítico** para `count-patio-windows`: deja de estimar patios y los lee de OSM cuando existen.

### 3. Refactor `count-facade-windows`

Reemplaza el bloque "Geometría de fachada (WMS-INSPIRE)" actual:

```ts
// ANTES: fetch directo a WFS-INSPIRE
// AHORA:
const geom = await fetchParcelGeometry({
  refcatastral_14, lat, lon, sbAdmin: sb, force: body.force,
});

// derivar aristas del exterior_ring → seleccionar fachada principal por
// criterio existente (perpendicularidad al bearing de calle).
// longitud_fachada_source = geom.source
```

Si `geom.source === 'fallback'` → desactivar validación de densidad (igual que hoy).
Añadir `geom.flags` al output y a la fila `facade_window_counts`.

### 4. Refactor `count-patio-windows`

Igual, pero además:
- Si `geom.interior_rings.length > 0` → calcular ventanas patio sobre el **perímetro real** de cada patio interior con la densidad calibrada por época (la lógica que ya existe). Confianza sube a `media` (antes capada en `media` por estimación; ahora media con base real).
- Si `interior_rings.length === 0` y `area_solar - area_construida_planta > umbral` → seguir estimando, flag `patio_estimado_sin_geometria`.
- Si `source === 'fallback'` → flag `patio_posiblemente_mancomunado` + confianza `baja`.

### 5. Manejo de rate limits Overpass

- Cola global en memoria por endpoint (1 req cada 1 s mínimo por endpoint).
- Retry sólo en 429, 502, 503, 504, network errors. Máx 3 intentos por endpoint, 3 endpoints → 9 intentos máximos antes de ceder a WFS.
- Log cada caída (`console.warn`) con endpoint, status, y rc14.
- Respeto `Retry-After` si viene en headers.

### 6. Aislamiento

- **No tocamos `compute_cluster_score`, recompute, ni UI.** Pure refactor de fuente de datos.
- `process-building-full` no cambia.
- Las dos edge functions (`count-facade-windows`, `count-patio-windows`) mantienen su contrato de salida exacto, sólo cambia el campo `source` interno y desaparece el flag `longitud_fachada_estimada` en la mayoría de casos.

## Criterio de aceptación

1. `POST /count-facade-windows {building_id: "<Díaz Porlier 47>"}` → `longitud_fachada_source: "overpass_ref"`, `cached: false` la primera vez, `cached: true` la segunda.
2. Repetir el POST → segunda llamada sin tocar Overpass.
3. `POST /count-patio-windows {building_id: "<Topete 33>"}` → si OSM tiene el patio, `interior_rings.length ≥ 1` y la ventanas-patio se calculan con perímetro real, no estimado.
4. Para 5-10 edificios de la cartera demo: ≥80% deben resolver vía `overpass_ref` u `overpass_bbox`, ninguno debería caer en `fallback` salvo casos extremos.
5. Forzar Overpass caído (apuntando a un host inválido a mano) → las funciones siguen funcionando vía WFS-INSPIRE, sin romper la salida.

## Orden de ejecución

1. Migración `parcel_geometry_cache` (espera aprobación).
2. Crear `_shared/parcel_geometry.ts` con todos los cálculos geométricos + Overpass + WFS fallback + caché.
3. Refactor `count-facade-windows`.
4. Refactor `count-patio-windows`.
5. Probar contra Díaz Porlier 47 y Topete 33 vía `curl_edge_functions`.

¿Apruebas el plan para pasar a build?
