## Pivot final: Cartera Demo (79) PRIMARY + masivo SECONDARY, con explainability total

**ANULA** mi pivot anterior de "procesar todos los 7772 sin CSV". Mantenemos el flujo Cartera Demo como primary y añadimos botón masivo como complemento bloqueado tras validación. Encima añadimos auditabilidad por fuente, reasoning natural en cada chip y resumen ejecutivo narrativo por edificio.

---

### Bloque A — Edge functions

**`analyze-building-vision` (editar)**

Cambiar el JSON de salida para que cada métrica deducida (numérica o booleana) sea un objeto:

```json
{
  "value": 28,
  "source": ["street_view_heading_0", "street_view_heading_90", "satellite"],
  "reasoning": "Conté 8 ventanas fachada principal SV Norte, 12 SV Este (esquina), 4 a patio interior vía satélite, +4 por simetría planta-tipo.",
  "confidence": 0.82
}
```

Aplicar a: `ventanas_fachada_total`, `ventanas_por_planta`, `n_escaleras_en_piso01`, `n_escaleras_en_planta_baja`, `viviendas_por_planta_tipo`, `n_locales_planta_baja`, `n_almacenes_sotano`, `tiene_sotano`, `tiene_azotea_transitable`, `patios_codigos`, `accesos_codigos`, `plantas_visibles`, `plantas_levantables`, `esquina`, `segundas_escaleras`, `protegido_historicamente`, `patios_detectados`, `metricas_extra.pct_terciario`.

Persistir el bloque completo en nuevo campo `building_analysis.metricas_detalle jsonb`. Los campos planos legacy se siguen escribiendo (compatibilidad) con `metricas_detalle[k].value`.

Prompt actualizado pide explícitamente, para cada métrica: `value`, `source` (enum cerrado), `reasoning` en español, `confidence` 0-1. Source enum: `catastro_pdf_piso_X`, `catastro_pdf_pb`, `catastro_pdf_general`, `street_view_heading_Y`, `satellite`, `oblique`, `dnprc_json`, `calculated_from_ancho_calle`, `inferred_symmetry`.

**`compute-building-score` (editar)**

Tras calcular score y breakdown:

1. Genera `avisos_inteligentes[]` con shape `{ id, label, icon, color, reasoning, confidence, sources }`. Las reglas de derivación quedan en código y cada aviso obtiene su reasoning narrativo (puede combinar plantilla + texto del `metricas_detalle.reasoning`). Avisos cubiertos: `ventanas_total`, `plantas_levantables`, `escaleras_dobles`, `esquina`, `historico`, `terciario_alto`. **Sin reasoning ⇒ aviso no se emite.**
2. Llama a Lovable AI (`google/gemini-2.5-flash`) con prompt: breakdown + métricas + avisos → devuelve párrafo 4-8 frases. Persiste en `buildings.score_summary text`.

Persiste avisos en `buildings.avisos_inteligentes` (jsonb ya existente).

**`auto-process-cartera-demo` (mantener tal cual + ajustes mínimos)**

- Sigue siendo el orquestador principal de los 79.
- Al final de cada item, dispara `compute-building-score` que ya genera summary + avisos con reasoning.

**Nueva edge function `auto-process-pending-buildings`**

Procesa el resto del CRM (no-cartera-demo) con prioridad: assignments del user → score v1 alto → resto. Filtro `catastro_data IS NULL OR building_analysis IS NULL`. Idempotente, concurrencia 2, sleep 2s. Solo se invoca desde el botón secundario.

---

### Bloque B — Migración SQL

```sql
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS metricas_detalle jsonb;

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS score_summary text,
  ADD COLUMN IF NOT EXISTS confianza_media numeric;

ALTER TABLE public.app_settings
  -- nada; usaremos key 'cartera_demo_validated' con valor { validated: bool, validated_at, validated_by }
  ;
```

Y aseguramos que `scoring_v2_jobs` admite `kind in ('cartera_demo','auto_pending')`.

---

### Bloque C — UI `/ajustes` (`AnalisisIAPanel.tsx`)

- **Botón primario (intacto)**: `🚀 Lanzar procesamiento Cartera Demo Mayo (79 edificios)`.
- **Toggle**: `✅ Marcar Cartera Demo como validada` → escribe `app_settings.cartera_demo_validated`.
- **Botón secundario**:
  - `📊 Procesar resto de edificios (X pendientes)` — X = `count(buildings) - count(building_analysis) - 79`.
  - `disabled` mientras `cartera_demo_validated.validated !== true`, con tooltip "Disponible tras validar los 79 de la Cartera Demo".

---

### Bloque D — Dashboard `/admin/jobs/:jobId` (`JobProgressPage.tsx`)

- KPI extra: **Confianza media** = `avg(building_analysis.metricas_detalle[*].confidence)` sobre los items procesados del job.
- Cuando el job es `kind='cartera_demo'` y termina, render del panel **VALIDACIÓN MANUAL**:
  - Tabla por edificio: `dirección | label esperado (BUENO/MALO/DOS_ESC) | score IA | avisos detectados | coincide SÍ/NO`.
  - Matriz de confusión por categoría con precision%.
  - Si todas las categorías ≥ 80%, muestra banner verde "Listo para batch masivo" y auto-marca `cartera_demo_validated.validated = true`.

---

### Bloque E — UI listado `/comercial/edificios` (`Edificios.tsx`)

- Nuevo componente `BuildingChips.tsx` renderiza chips desde `avisos_inteligentes[]`. Máx 4. Color: `oportunidad` verde, `alerta` naranja, `neutro` muted (incluye `⏳ Análisis IA pendiente` si `building_analysis IS NULL`).
- Cada chip: **Tooltip on hover** con `aviso.reasoning` + barra de confidence. Click abre popover con detalle largo y fuentes (mismo contenido que la ficha).
- Hover sobre el `score` del card → tooltip con primeras 2 frases de `score_summary`.
- **Filtro nuevo**: slider `Confianza mínima` 0–100% que filtra por `confianza_media >= x`.
- Mantener pestaña "Marcados manualmente" usando `cartera_demo_seed=true` (no se elimina).

---

### Bloque F — UI ficha edificio `/comercial/edificios/:id`

- **Nueva card destacada arriba del todo en tab "Análisis IA"**: `📋 Resumen ejecutivo` con `score_summary`, tipografía mayor, antes del score y chips.
- **Card "Métricas extraídas IA"** se reescribe: cada métrica es un item expandible (Accordion / Collapsible). Al expandir muestra:
  - Sources con iconos: `📐 Plano Catastro` / `📷 Street View dir N` / `🛰️ Satélite` / `🖼️ Oblicua` / `🧮 Calculado` / `📄 DNPRC`.
  - `reasoning` natural en español.
  - Barra de confidence.
  - Thumbnails de cada source clickables → abren lightbox en la imagen/página específica.
- **Card "Avisos inteligentes"**: cada chip expandible con su `reasoning` largo (mismo dato que el listado).
- Botón "📥 Descargar Catastro + Planos + IA" cabecera: sin cambios.

---

### Archivos

**Crear**
- `supabase/migrations/<ts>_explainability_and_summary.sql`
- `supabase/functions/auto-process-pending-buildings/index.ts`
- `src/components/comercial/BuildingChips.tsx`
- `src/components/comercial/MetricasDetalleCard.tsx`
- `src/components/comercial/AvisosInteligentesCard.tsx`
- `src/components/comercial/ResumenEjecutivoCard.tsx`
- `src/components/admin/ValidacionManualPanel.tsx`

**Editar**
- `supabase/functions/analyze-building-vision/index.ts` (prompt + shape + persistencia `metricas_detalle`)
- `supabase/functions/compute-building-score/index.ts` (avisos con reasoning + llamada summary LLM)
- `src/components/settings/AnalisisIAPanel.tsx` (toggle + botón secundario)
- `src/pages/admin/JobProgressPage.tsx` (KPI confianza + panel validación)
- `src/pages/comercial/Edificios.tsx` (chips + filtro confianza + tooltip score)
- `src/pages/comercial/EdificioDetalle.tsx` (insertar las 3 cards nuevas en tab Análisis IA)

---

### Validación

1. Lanzar Cartera Demo (79). Dashboard muestra confianza media.
2. Al terminar, panel Validación Manual con matriz. Si ≥80%, banner verde + auto-validado.
3. Botón secundario "Procesar resto" se habilita.
4. Listado: chips con tooltip reasoning, slider confianza filtra.
5. Ficha edificio: resumen ejecutivo arriba, métricas expandibles con fuentes clickables, avisos expandibles.

¿Procedo?