# Fase 5 — `count-facade-windows` (v2, revisada)

Incorpora las 3 modificaciones críticas + ajustes menores del review.

## Cambios vs v1

1. **Longitud y heading de fachada** se calculan desde el polígono real de Catastro (WMS-INSPIRE GetFeature GeoJSON), no `sqrt(area)` ni 4 headings con VLM.
2. **`plantas_residenciales_visibles` ≠ `plantas_tipo`** con definiciones excluyentes.
3. **Caché de Street View** + retries; `vlm_raw_response` como `text` + `parsed jsonb` opcional; `ejes_por_imagen[]` en la salida del VLM.

## 1. Migración SQL

```sql
create table public.facade_window_counts (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  refcatastral_14 text not null,
  vlm_raw_response text not null,              -- text, evita romper inserts si llega con ```json fences
  vlm_parsed jsonb,                            -- parseo best-effort
  street_view_panoramas jsonb not null,
  fachada_principal jsonb not null,
  fachada_secundaria jsonb,
  longitud_fachada_m numeric,
  longitud_fachada_source text,                -- 'wms_inspire' | 'sqrt_area_fallback'
  final_count integer not null,
  ejes_verticales integer not null,
  confidence text not null,
  flags text[] not null default '{}',
  created_at timestamptz not null default now()
);
-- GRANT SELECT, INSERT, UPDATE, DELETE authenticated; GRANT ALL service_role
-- RLS: SELECT authenticated; INSERT/UPDATE/DELETE solo service_role
create index on public.facade_window_counts(building_id, created_at desc);
create index on public.facade_window_counts(refcatastral_14);
```

Bucket privado `street-view-captures` (idempotente).

## 2. Edge function `supabase/functions/count-facade-windows/index.ts`

### Entrada
```ts
{ building_id: string; force?: boolean }
```

### Flujo

**(A) Cargar autoridad Catastro**
- Leer `catastro_authority_cache` por `refcatastral_14` (derivado de `buildings`). Si missing/stale → invocar `catastro-authority-layer` primero.
- Derivar:
  - `inferred_floor_count` = `plantas_residenciales_visibles.length` = plantas con uso residencial sobre rasante (BJ + EN + 01..N + BC), excluye CUB/TZA/sótanos.
  - `has_entresuelo` = `plantas[].codigo` contiene `EN`.
  - **`plantas_tipo`** = count(plantas con `/^\d{2}$/` y al menos 1 uso residencial). Estrictamente excluye BJ/EN/BC/TZA/CUB/sótanos. *(deuda: detección visual de entresuelo no catastrado → Fase 6)*.
  - `centroid` = `{lat, lon}`.

**(B) Geometría de fachada (WMS-INSPIRE)**
- `GET https://ovc.catastro.meh.es/INSPIRE/wfsParcel.aspx?service=WFS&version=2.0.0&request=GetFeature&typeNames=cp:CadastralParcel&srsName=EPSG:4326&Filter=<ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>cp:nationalCadastralReference</ogc:PropertyName><ogc:Literal>{rc14}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>&outputFormat=application/json`
- Parsear polígono GeoJSON → lista de aristas con `[length_m, azimuth_deg]` (haversine + bearing).
- Reverse geocode del centroide (Google) → nombre de calle + bearing de la calle (2 puntos consecutivos en la calle vía Roads/Directions o, fallback, usar `vector tangente` entre puntos cercanos del polígono de calle de OSM/Overpass; si no disponible, fallback a bearing entre centroide y el punto más cercano del polígono de la parcela hacia el exterior).
- **Fachada principal** = arista cuyo azimut es más perpendicular al bearing de la calle Y que toca la línea de calle.
- `longitud_fachada_m` = longitud de esa arista. `longitud_fachada_source = 'wms_inspire'`.
- `heading_fachada` = azimut de la normal exterior a esa arista (matemático, no VLM).
- **Fallback** si WMS o reverse geocode fallan: `sqrt(area)` + `longitud_fachada_source = 'sqrt_area_fallback'` + flag `longitud_fachada_estimada`; en este caso *desactivar* la validación de densidad (no flag falso).

**(C) 3 capturas Street View**
- Punto central: `centroid` + offset 8 m hacia `-heading_fachada` (alejarse de la fachada hacia la calle).
- Laterales: ±6 m en vector tangente (perpendicular al heading).
- Heading apuntando a la fachada, FOV=110, size=640×640, `GOOGLE_MAPS_API_KEY`.
- **Retries**: 2 con backoff exponencial (300ms, 900ms) por captura antes de marcar fallida.
- **Caché**: si `street-view-captures/{building_id}/{0,1,2}.jpg` existen y `< 90 días` y `!force` → reusar (no llamar Google, no subir).
- Si <3 capturas válidas → flag `cobertura_streetview_insuficiente`, `confidence: "baja"`.

**(D) VLM (Lovable AI Gateway, `google/gemini-2.5-pro`)**
- Prompt vinculante del spec, inyectando `{inferred_floor_count, has_entresuelo, plantas_tipo, longitud_fachada_m}`.
- Pedir además en el JSON:
  ```json
  "ejes_por_imagen": [
    { "image_index": 0, "ejes_visibles": N, "completos": bool },
    ...
  ]
  ```
- Guardar respuesta cruda en `vlm_raw_response` (text). Intentar `JSON.parse` con limpieza de fences ```` ```json ```` → `vlm_parsed`.

**(E) Validación dura**
- `ejes ∈ [3,15]` sino → flag `ejes_fuera_de_rango`.
- Si `longitud_fachada_source === 'wms_inspire'`: comprobar `total / longitud_fachada_m ∈ [1.5, 4.5]` → flag `densidad_inusual` si fuera. Si `sqrt_area_fallback`, skip.
- Recompute fórmula determinista; si difiere del VLM → flag `formula_no_se_cumple` y devolver el valor de la fórmula (no el del VLM).
- VLM contradice `inferred_floor_count` → sobrescribir, flag `vlm_contradice_catastro`.
- `max(ejes_por_imagen) - min(ejes_por_imagen) > 2` → flag `divergencia_entre_capturas`, bajar a `media`.

**(F) Segunda fachada**
- Si `edificio_hace_esquina && se_ve_segunda_fachada`: repetir capturas con heading +90°, y nueva llamada VLM. Reutilizar geometría de aristas para detectar la otra fachada.

**(G) Persistir** fila + 3 jpgs.

### Salida
```json
{
  "fachada_principal": { "ejes_verticales_detectados": 7, "plantas_tipo": 5,
    "ventanas_planta_baja": 6, "ventanas_entresuelo": 6, "ventanas_plantas_tipo": 35,
    "total": 47, "confidence": "alta", "flags": [] },
  "fachada_secundaria": null,
  "total_ventanas_fachada_exterior": 47,
  "longitud_fachada_m": 17.4,
  "longitud_fachada_source": "wms_inspire",
  "notas_vlm": "...",
  "audit_id": "uuid"
}
```

## 3. Config / CORS

- `_shared/scoring_v2_common.ts` para `corsHeaders`, `getServiceClient`, `json`, `err`.
- `verify_jwt = false` (default Lovable Cloud).
- Secrets requeridos (verificar con `fetch_secrets` antes de codificar): `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY`.

## 4. Aislamiento

No toca `process-building-full`, `analyze-building-vision`, scoring, ni UI. Pure-add.

## 5. Criterio de aceptación (Díaz Porlier 47)

`POST /count-facade-windows {building_id: "36147ab5-459e-4048-a112-bcdfaca43aec"}` →
- `longitud_fachada_m ≈ 17–18`, `longitud_fachada_source: "wms_inspire"`
- `ejes_verticales_detectados = 7 ± 1`
- `total ∈ [45, 49]`
- `confidence: "alta"`, `flags: []` o como mucho `divergencia_entre_capturas`
- Fila persistida, 3 jpgs en Storage

## 6. Deuda técnica anotada (no bloquea Fase 5)

- Detección visual de entresuelo no catastrado (Fase 6).
- Ventanas a patios (Fase 5.5).
- Polígono de calle real (Overpass/OSM) para bearing si Google no devuelve buen vector tangente.
- Few-shot con mirador de Díaz Porlier 47 si Gemini cuenta paños.

¿Apruebas esta v2 para pasar a build?
