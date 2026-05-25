## Orquestación end-to-end Cartera Demo (79 edificios)

Pipeline completo para que el cliente solo suba el CSV y pulse un botón. Todo el procesamiento Catastro PDF + Google Imagery + Gemini Vision + Score corre en edge functions, con dashboard de progreso en tiempo real.

### 1. Migración DB

```sql
ALTER TABLE buildings ADD COLUMN cartera_demo_seed boolean NOT NULL DEFAULT false;
CREATE INDEX idx_buildings_cartera_demo ON buildings(cartera_demo_seed) WHERE cartera_demo_seed = true;

ALTER TABLE catastro_data ADD COLUMN fetch_quality text DEFAULT 'high'; -- 'high' | 'low'

-- jobs ya existe (scoring_v2_jobs), añadimos phase tracking detallado si falta
ALTER TABLE scoring_v2_jobs 
  ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS phase_progress jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS total_items integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_items integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_items integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_status jsonb DEFAULT '[]'::jsonb;
```

### 2. Edge function `import-seed-79-edificios`

- Lee `scoring_v2_seed` rows (subidas por el CSV uploader existente)
- Match por `metadatos->>'hs_object_id' = deal_id` o fuzzy address con `similarity()` ≥ 0.55 + ciudad
- Marca `buildings.cartera_demo_seed = true` en los matched
- Persiste `matched_building_id` en seed row; deja NULL los no matcheados
- Devuelve `{ matched: N, unmatched: M, unmatched_list: [...] }`

### 3. Cambios "Mi cartera" en `/comercial/edificios`

- Query OR: `building_assignments.user_id = current_user OR cartera_demo_seed = true`
- Badge dorado `DEMO 25/05` en cards con `cartera_demo_seed`

### 4. Edge function `auto-process-cartera-demo` (orquestador)

- Selecciona todos los buildings con `cartera_demo_seed=true`
- Crea job en `scoring_v2_jobs` (kind=`cartera_demo`, total_items=N)
- Loop secuencial concurrencia 2, sleep 2s entre items, retry 3× backoff exponencial:
  - **Fase A**: `fetch-catastro-data` (PDF distribución plantas, fallback SVG con `fetch_quality='low'`)
  - **Fase B**: `fetch-google-imagery` (satélite + 4 streetview + oblicua)
  - **Fase C**: `analyze-building-vision` con Gemini 2.5 Flash + PDF nativo + 6 imágenes
  - **Fase D**: `compute_score(building_id)` SQL
- Update `scoring_v2_jobs` por cada item (phase, processed, failed, items_status[])
- Si una fase falla >50% → marca job `aborted`
- Devuelve `{ job_id }` inmediatamente, procesa en background con `EdgeRuntime.waitUntil`

### 5. Prompt Gemini Vision (actualización)

Instrucción específica:
- **ESC en PISO 01** → contar escaleras (no en planta baja)
- **VA/VB/VC** → viviendas por planta tipo
- **P01–P04** → patios
- **CCE/GC** → locales comerciales planta baja
- **TZ** → azotea piso superior

### 6. UI Activador en `/ajustes`

Botón grande naranja en `AnalisisIAPanel`:
> 🚀 Lanzar procesamiento Cartera Demo Mayo (79 edificios)

Al pulsar:
1. Invoca `auto-process-cartera-demo`
2. Navega a `/admin/jobs/:jobId`

### 7. Página `/admin/jobs/:jobId`

- Polling cada 2s a `scoring_v2_jobs`
- KPI cards: `X/79 procesados`, `Y con score`, `Z con avisos`
- Progress bar por fase
- Tabla edificios con estado verde/amarillo/rojo
- Cuando `status=done` o `aborted`: toast + redirect a `/comercial/edificios?filter=cartera_demo` ordenado por score desc

### 8. Filtro URL en listado

`?filter=cartera_demo` aplica chip "Cartera Demo Mayo" + sort score desc.

### Archivos a crear/modificar

**Migración**: 1 archivo SQL.

**Edge functions nuevas**:
- `supabase/functions/import-seed-79-edificios/index.ts`
- `supabase/functions/auto-process-cartera-demo/index.ts`

**Edge functions a editar**:
- `analyze-building-vision`: actualizar prompt con códigos específicos
- `fetch-catastro-data`: setear `fetch_quality='low'` cuando cae a SVG fallback

**Frontend**:
- `src/components/settings/AnalisisIAPanel.tsx`: botón grande lanzador + handler import seed
- `src/pages/admin/JobProgressPage.tsx` (nuevo): dashboard polling
- `src/App.tsx`: ruta `/admin/jobs/:jobId`
- `src/pages/comercial/EdificiosList.tsx` (o el actual de listado): query OR cartera_demo, badge DEMO, filtro URL

### Notas técnicas

- Concurrencia 2 con `Promise.allSettled` por chunks de 2
- Retry helper inline con backoff `2000 * 2^attempt`
- `EdgeRuntime.waitUntil(processCartera(jobId))` para no bloquear la respuesta HTTP
- Realtime suscripción a `scoring_v2_jobs` en `JobProgressPage` (alternativa al polling)

### Confirmación final

Cuando todo deplegado: subir CSV → pulsar 1 botón → ver dashboard → toast al final → ranking en `/comercial/edificios`.
