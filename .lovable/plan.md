## F.1 Coach Comercial — Plan de ejecución

Tres fases encadenadas sin pausa tras tu aprobación.

### F.1.a — Backend análisis de transcripciones

**1. Migration `calls`** (añadir columnas + índices, sin tocar datos):
- `outcome text` CHECK in ('interesado','dudoso','no_interesado','no_contestado','agente_bloqueado','otro')
- `sentiment text` CHECK in ('positivo','neutro','negativo')
- `objeciones text[]` default `'{}'`
- `tecnica_score numeric`, `preguntas_abiertas int`, `preguntas_cerradas int`
- `ratio_comercial_cliente numeric`
- `frases_clave_positivas text[]`, `frases_clave_negativas text[]`
- `analisis_confianza numeric`, `analyzed_at timestamptz`
- Índices: `(owner_id, fecha)`, `(outcome)`, `(sentiment)`

**2. Edge function `analyze_call`** (`POST {call_id}`):
- Lee `calls.transcripcion`. Si null/<200 chars → marca `outcome='no_contestado'` sin llamar IA.
- Llama Lovable AI Gateway → `google/gemini-3-flash-preview` con `response_format: json_object` y prompt en castellano que devuelve el schema completo.
- Persiste columnas + fila en `agent_runs` (agent_name=`analyze_call`, latencia, tokens, confianza).
- Idempotente: re-ejecutar sobre la misma call sobreescribe.

**3. Edge function `analyze_calls_batch`** (orquestador):
- Cursor en `hubspot_sync_state` (entity=`analyze_calls`).
- `MAX_PER_RUN=20`, encadena con `fetch` self-invoke hasta `phase=done`.
- Procesa solo `transcripcion IS NOT NULL AND analyzed_at IS NULL`.

### F.1.b — Frontend `/productividad` (admin)

Ruta nueva, entrada en sidebar grupo IA con icono `BarChart3`. Acceso restringido por `has_role(admin)`. Componentes:

1. **Header**: Select comercial (Todos / Marta / David / Jesús; Cristina deshabilitada) + Select rango (7d/30d/90d/personalizado).
2. **Cards KPI**: total calls, % atendidas, duración media, conversión stage, stale rate, sentiment medio.
3. **Heatmap día×hora** con tabs *Cuándo llama* / *Cuándo convierte* (grid 7×24 con `hsl(var(--primary)/X)`).
4. **Tabla comparativa** comerciales.
5. **Barras outcome** + **top objeciones** + **frases ganadoras/perdedoras** + card **mejor combinación**.

Datos: queries directos a `calls` agregadas en cliente (volumen <10k filas, manejable).

### F.1.c — Coach IA semanal

**Tabla nueva `coach_reports`**:
- `id, owner_id, week_start date, week_end date, fortalezas jsonb, mejoras jsonb, frases_ganadoras text[], plan_accion jsonb, generated_at`
- UNIQUE `(owner_id, week_start)`, RLS preview-all.

**Edge function `generate_coach_report`** (`POST {owner_id?, week_start?}`):
- Si no llega owner_id → procesa todos los comerciales activos en chunks de `MAX_REPORTS_PER_RUN=5`, cursor en `hubspot_sync_state`.
- Agrega calls de la semana + outcome/sentiment/objeciones/técnica.
- Llama Lovable AI con prompt en castellano → JSON con fortalezas/mejoras/frases/plan_accion.
- UPSERT por `(owner_id, week_start)`.

**Cron**: `coach-weekly` lunes 8AM (vía `supabase--insert` con SQL `cron.schedule`).

**UI**: tab "Coach IA" en `/productividad` con cards por comercial + selector de semana.

### Orden de ejecución

1. Migration calls + tabla coach_reports → **espero approve**.
2. Crear `analyze_call`, `analyze_calls_batch`, `generate_coach_report` edge functions.
3. Lanzar batch analyze_calls (encadenado).
4. Construir página `/productividad` + entrada sidebar + ruta + guard admin.
5. Programar cron coach-weekly (vía insert tool).
6. Disparar primer `generate_coach_report` para los 3 comerciales activos.
7. Reporte final con métricas que pediste.

### Reglas

- HubSpot read-only (cero writes a HubSpot).
- Idempotencia en ambos UPSERTs.
- Sin tocar `buyer_persona`, `rol`, `subrole`.
- Si timeout en cualquier batch → persistir cursor + auto-chain.
- Sin avanzar a E.1 hasta tu confirmación.

### Notas técnicas

- Edge functions usan `LOVABLE_API_KEY` (ya disponible).
- `analyze_call` corre con `verify_jwt=false` (default) para permitir auto-chain server-side.
- Prompts viven en el backend, nunca en cliente.
- `/productividad` también accesible desde `/admin/productividad` (alias en App.tsx).

¿Apruebo y arranco?