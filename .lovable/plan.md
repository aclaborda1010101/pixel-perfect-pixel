
# Refactor: un único Score unificado (sin v1/v2)

## 1. Base de datos (1 migración)

### 1.1 Reescribir vista `v_building_score`
Mantiene todas las columnas existentes (la usa `/comercial/edificios` y la ficha). Añade:
- `has_ai_analysis boolean` — true si existe fila en `building_analysis`
- `score_base numeric` — los 5 componentes actuales (s_viviendas, s_m2, s_ratio, s_owners, s_no_dh) *100 (igual que ahora)
- `score_ai numeric` — suma de bonificaciones IA (0 si no hay análisis)
- `score numeric` — `LEAST(100, score_base + score_ai)` (reemplaza el cálculo actual)
- `score_breakdown jsonb` — array unificado con TODOS los componentes que aplican (los 5 base siempre, los IA si hay análisis), cada uno con `{key, label, valor_raw, peso, contribucion}`

Componentes IA (aplicados cuando `building_analysis` existe; suman al base, cap a 100):
- `ventanas_total * 1.5` (cap 30)
- esquina: `+25`
- segundas_escaleras: `+30`
- `plantas_levantables * 15` (cap 45)
- protegido_historicamente: `+15`
- terciario_pct > 66%: `+25` (calculado desde metadatos m² comercio/oficina/industrial vs total)
- intencion_venta (campo `building_analysis.metricas_extra->>intencion_venta` si existe): `+35`
- m2_total < 300: `-25`

### 1.2 Sustituir `compute_score_v2(building_id)` por `compute_score(building_id)`
- Lee la nueva `v_building_score` para ese id y escribe `buildings.score`, `buildings.score_breakdown`, `buildings.avisos_inteligentes`, `buildings.score_updated_at`.
- Drop `compute_score_v2` y `trg_recompute_score_v2`; crear `trg_recompute_score` sobre `building_analysis` (insert/update) que llama a `compute_score`.

### 1.3 Columnas en `buildings`
- `ALTER COLUMN score_v2 RENAME TO score`
- `ALTER COLUMN score_v2_breakdown RENAME TO score_breakdown`
- `ALTER COLUMN score_v2_updated_at RENAME TO score_updated_at`
- Mantiene `avisos_inteligentes` con el mismo nombre.

### 1.4 Limpieza
- `DELETE FROM app_settings WHERE key = 'scoring_v2_enabled'`.

## 2. Frontend

### 2.1 `/ajustes` — `ScoringV2Panel` → `AnalisisIAPanel`
- Renombrar archivo a `src/components/settings/AnalisisIAPanel.tsx`.
- Quitar toggle `scoring_v2_enabled` y todo su estado.
- Cabecera: "Análisis IA · Catastro · Google · Gemini".
- Resto igual: validar GOOGLE_MAPS_API_KEY, subir CSV seed, grid 2×2 batches (Catastro/Imagery/Vision/Recompute), KPIs (con catastro / con imagery / con análisis IA / con score), tabla últimos jobs.
- `Settings.tsx`: importar y renderizar siempre `<AnalisisIAPanel />`.

### 2.2 `/comercial/edificios/:id`
- `ScoringV2Section` → `AnalisisIASection` (archivo movido a `src/components/comercial/AnalisisIASection.tsx`).
- Visible SIEMPRE (sin `useScoringV2Flag`). Si no hay análisis: stepper "pendiente" + CTA "Descargar Catastro + Imágenes + IA"; si lo hay: muestra ventanas, esquina, escaleras, plantas levantables, imágenes, modelo.
- En la card "Factores que aportan al score" leer **el nuevo `score_breakdown` unificado** (en lugar de derivar solo de las 5 columnas `s_*`). Fallback al cálculo actual si el breakdown viene vacío.
- Badge dorado "Análisis IA pendiente — pulsa Descargar Catastro" cuando `has_ai_analysis === false`.

### 2.3 `/comercial/edificios` listado
- Sin cambios en la columna `Score` (ya lee `v_building_score.score`); el score ahora es el unificado automáticamente.

### 2.4 `src/lib/scoringV2.ts`
- Eliminar `useScoringV2Flag`. Renombrar `useBuildingAnalysis` y `useBuildingProcessing` y moverlas a `src/lib/analisisIA.ts`.

## 3. Edge functions
- `analyze-building-vision` y `process-building-full`: cambiar `rpc("compute_score_v2", ...)` por `rpc("compute_score", ...)`.

## 4. Componentes/archivos a borrar
- `src/lib/scoringV2.ts` (sustituido por `src/lib/analisisIA.ts`)
- `src/components/comercial/scoring-v2/ScoringV2Section.tsx` (sustituido)
- `src/components/settings/ScoringV2Panel.tsx` (sustituido)

## Validación tras aplicar
1. La vista `v_building_score` devuelve score coherente para edificios con y sin análisis.
2. `/comercial/edificios` muestra scores ordenados.
3. Edificio sin análisis: badge "pendiente"; edificio con análisis: bonus visible en el desglose.
4. `/ajustes` sin toggle, panel renombrado, CSV/validate/batches operativos.

## Riesgos
- La vista `v_building_score` ya está usada en otros sitios; conservo todas sus columnas y solo añado tres (`has_ai_analysis`, `score_base`, `score_ai`, `score_breakdown`) y redefino `score`.
- Renombrar columnas requiere actualizar `types.ts` (auto-generado) — el frontend cambia a usar `score`/`score_breakdown` directamente.
