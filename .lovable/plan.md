# Scoring v2 Inmobiliario — Catastro + Google Maps + Gemini Vision

Capa nueva detrás del flag `scoring_v2_enabled`. NO toca el scoring v1 actual.

**Stack IA confirmado (ambos Google, ambos vía Lovable AI Gateway → 0 secrets nuevos de IA)**:
- **Primario**: `google/gemini-2.5-flash` (barato, rápido, multimodal).
- **Fallback**: `google/gemini-3.5-flash` si `confidence<0.6` o JSON inválido tras 3 reintentos.
- Endpoint único: `https://ai.gateway.lovable.dev/v1/chat/completions` con `LOVABLE_API_KEY` (ya existe).
- **NO se usa Claude ni GEMINI_API_KEY directa** → simplifica enormemente.
- SVG→PNG con `npm:@resvg/resvg-js` antes de mandar a la IA (las imágenes van como `image_url` data URI en formato OpenAI-compatible que acepta el gateway).
- Matching seed: `buildings.metadatos->>'hs_object_id'` + fuzzy `pg_trgm`.
- Concurrencia: batches de 50, `has_more=true`, UI hace polling.

---

## 1. Migración SQL (única)

### Tablas nuevas (RLS: `authenticated SELECT`, `service_role` ALL)
- `catastro_data` (PK `refcatastral`, FK `building_id`, `lat/lon`, `plano_url`, `dnprc_json`, `ancho_calle_m`, `fetched_at`, `fetch_error`)
- `building_imagery` (PK uuid, FK `building_id`, `source CHECK IN ('satellite','streetview','oblique')`, `heading/pitch/zoom`, `file_path`, `public_url`, `fetched_at`)
- `building_analysis` (PK uuid, `building_id UNIQUE`, métricas + `modelo_usado text`, `modelo_fallback boolean`, `sources_used jsonb`, `confidence numeric`, `llm_raw_response jsonb`, `analyzed_at`, `analyze_error`)
- `app_settings` (PK `key`, `value jsonb`) — seed: `scoring_v2_enabled=false`, `google_maps_api_key_configured=false`
- `scoring_v2_seed` (PK `edificio` + cols CSV + `matched_building_id`, `matched_at`)
- `scoring_v2_jobs` (PK uuid, `phase`, `status`, `total/processed/failed`, `log jsonb`, `started_at/finished_at`)
- `scoring_v2_feedback` (PK uuid, FK `building_id`, `aviso_key`, `vote int`, `user_email`, `notes`, `created_at`)
- `building_processing_status` (PK `building_id`, `current_phase`, `status`, `started_at/finished_at`, `error`)

### Columnas nuevas en `buildings`
`refcatastral text UNIQUE`, `score_v2 numeric`, `score_v2_breakdown jsonb`, `score_v2_updated_at timestamptz`, `avisos_inteligentes jsonb`.

### Buckets Storage
`catastro` y `building_imagery` (públicos) + policies de lectura pública y escritura solo `service_role`.

### Funciones PL/pgSQL
- `compute_score_v2(p_building_id uuid) RETURNS numeric` — escribe `score_v2`, `score_v2_breakdown`, `avisos_inteligentes`, `score_v2_updated_at`.
- `madrid_plantas_max(ancho_m numeric)` — `>20→7`, `12-20→6`, `8-12→5`, `<8→4`.
- `recompute_all_scores_v2() RETURNS int`.

---

## 2. Secrets

**Sólo 1 secret nuevo a pedir desde `/admin`** (no usa `add_secret`, lo guarda en `app_settings`): `GOOGLE_MAPS_API_KEY`.

`LOVABLE_API_KEY` ya existe → cubre Gemini 2.5 Flash + Gemini 3.5 Flash. **Cero secrets de IA pendientes.**

---

## 3. Edge functions (6 nuevas)

| Nombre | Input | Output |
|---|---|---|
| `seed-edificios-import` | multipart CSV | `{matched, unmatched:[], total}` |
| `fetch-catastro-data` | `{building_id}` | `{refcatastral, lat, lon, plano_url, status}` |
| `fetch-google-imagery` | `{building_id}` | `{imagenes:[…], skipped:[…]}` |
| `analyze-building-vision` | `{building_id}` | `{analysis_id, score_v2, modelo_usado, modelo_fallback}` |
| `batch-pipeline-scoring-v2` | `{phase, cursor?, job_id?}` | `{job_id, processed, failed, has_more, next_cursor}` |
| `process-building-full` | `{building_id, force?}` | `{status, refcatastral, score_v2}` (orquesta los 3 pasos) |

### Detalles clave
- **Nominatim**: `User-Agent: AffluxProperty/1.0 (acifuentes@abius.es)`, sleep 1.1s.
- **Catastro**: `Consulta_RCCOOR` + `Consulta_DNPRC` JSON; `GeneraGraficoParcela.aspx` → regex `<svg…</svg>` → bucket `catastro/{refcat}.svg`. Idempotente.
- **Google Static**: 1 satélite z=20, 1 oblicua hybrid z=19, 4 Street View (h=0/90/180/270, fov=80, pitch=10). Skip si `<5KB`.
- **Vision (Lovable AI Gateway, OpenAI-compatible)**:
  ```
  POST https://ai.gateway.lovable.dev/v1/chat/completions
  { "model": "google/gemini-2.5-flash",
    "messages": [{"role":"user","content":[
       {"type":"text","text": prompt},
       {"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}
    ]}],
    "response_format": {"type":"json_object"} }
  ```
  Si parse falla 3× con backoff 2/4/8s **o** `confidence<0.6` → mismo payload con `model: "google/gemini-3.5-flash"`. Persiste `modelo_usado` y `modelo_fallback=true`.
  Manejo explícito de **429** y **402** del gateway → guarda en `analyze_error` y devuelve mensaje claro.
- Validación input con **Zod** en cada handler. CORS estándar.

---

## 4. UI

### `src/pages/comercial/EdificioDetalle.tsx`
- Header: botón gradient "📥 Descargar Catastro + Planos + Análisis IA" / "🔄 Re-procesar" (sólo si flag).
- Stepper inline 3 pasos (Catastro 📍 → Google 📷 → IA 🧠) con polling 2s a `building_processing_status` vía `useQuery({refetchInterval})`.
- Tab nuevo "Análisis IA" (grid 12 col): izda visor SVG + thumbnails con lightbox; dcha score grande, desglose tabla, avisos con feedback thumbs, métricas, panel **POTENCIAL DE ELEVACIÓN** naranja con visualización vertical y modal normativa Madrid.

### `src/pages/comercial/Edificios.tsx`
- Columna ordenable "Score v2" (default desc cuando flag activo).
- Filtros: multi-select avisos (7 opciones) + estado análisis (Sin Catastro / Sin Imagery / Sin Vision / Completo).

### Admin (en `src/pages/Settings.tsx` como nuevo `<ScoringV2Panel />`)
- Toggle `scoring_v2_enabled`.
- Input + "Validar y guardar" `GOOGLE_MAPS_API_KEY` (probe Static Maps API).
- **No pide GEMINI_API_KEY** (usa LOVABLE_API_KEY).
- Upload CSV seed → `seed-edificios-import`.
- Grid 2×2 de batches con progress bar (polling `scoring_v2_jobs` 2s).
- KPIs + histograma `score_v2` (0-25/26-50/51-75/76-100/100+).
- Tabla últimos 10 jobs.

### Helpers
- `src/lib/scoringV2.ts`: `useScoringV2Flag()`, `useBuildingProcessing(buildingId)`.
- `src/components/comercial/scoring-v2/`: `StepperProcessing.tsx`, `ImageLightbox.tsx`, `ElevationVisual.tsx`, `AvisosChips.tsx`, `DesgloseTable.tsx`, `ScoringV2Tab.tsx`, `ProcessFullButton.tsx`.
- `src/components/settings/ScoringV2Panel.tsx`.

---

## 5. Orden de build

1. Migración SQL (espera aprobación).
2. 6 edge functions en paralelo.
3. UI (helpers + componentes + edits en `EdificioDetalle.tsx`, `Edificios.tsx`, `Settings.tsx`).
4. Smoke test: `fetch-catastro-data` sobre 1 building → reporte.
5. Reporte final con pasos pendientes para ti en `/admin` (sólo 2: toggle flag + pegar `GOOGLE_MAPS_API_KEY`).

## 6. Out of scope
- No lanzo los batches (los lanzas tú desde `/admin`).
- No valido los 3 seed hasta tener tu primer run.

¿Apruebas para pasar a build?