# Plan F3 — Sistema comercial "llamadas de zona"

## 0. Cierre de flecos F2

### 0.1 Prompt de `agent_analyze_feedback`
Reescribir el system prompt para fijar la nomenclatura real:
- Tabla destino válida sólo entre: `building_analysis`, `buildings`, `catastro_authority_cache`, `building_owners`.
- Lista cerrada de campos por tabla (la misma whitelist que `apply_feedback_override`).
- Mapping explícito por dimensión:
  - `proteccion` → `building_analysis.protegido` (bool) y opcionalmente `protegido_raw` jsonb con `{manual:{fuente,nota}}`.
  - `escaleras` → `building_analysis.escaleras` (int).
  - `ventanas` → `building_analysis.ventanas_total` (int).
  - `m2` → `catastro_authority_cache.m2_total` o `building_analysis.m2_total`.
  - `viviendas` → `catastro_authority_cache.viviendas_total`.
  - `cluster` → `building_analysis.cluster_label` (enum).
  - `propietarios` → `building_owners.pct_propiedad` (con `owner_id` en payload).
- Few-shot con caso Topete 33 (devuelve override sobre `building_analysis.protegido=true` + `protegido_raw.manual.fuente='APE Bellas Vistas'`).
- Ampliar whitelist de `apply_feedback_override` para incluir esos campos.
- Re-test con el feedback de Topete 33: aplicar override de 1 clic.

### 0.2 Panel `/settings/aprendizaje`
- Nueva ruta + componente `AprendizajePanel.tsx`. KPIs: total feedbacks, % aplicados/descartados/requiere_código, tiempo medio análisis. Tabla "Feedbacks por dimensión" (count). Tabla "Patrones detectados" (group by `dimension` + `analisis_ia->>'origen'`). Cola "Requiere cambio de código" con link al edificio. Botón "Resumen IA semanal" → llamada simple a Lovable AI con los últimos 50 feedbacks y devuelve sugerencias agregadas.

### 0.3 Badge en Dashboard admin
- En `Dashboard.tsx`: contador de `building_feedback` con `estado='requiere_codigo'`, badge destructivo y link a `/settings/aprendizaje?filter=requiere_codigo`.

---

## 1. Baseline métricas de llamadas

Vista SQL `v_calls_baseline` materializada o consulta directa: por comercial (`hs_owner_id`) y semana (`date_trunc('week', created_at)`):
- buckets de duración (0-15, 15-45, 45-90, >90 s)
- total llamadas, % >60s, duración media/mediana

Nuevo bloque "Baseline llamadas" en `Productividad.tsx`:
- Histograma stacked por comercial (Recharts, ya en el stack).
- Tabla semanal con % >1min y nº llamadas.
- Selector de rango (últimas 4/12/26 semanas).
- Banner: "Punto de comparación pre-sistema F3".

---

## 2. Wizard de llamada paso-a-paso

Refactor de `src/pages/wizards/PrepareCallWizard.tsx` en flujo de 3 pasos (componente `<Wizard>` con `Stepper`).

**Paso 1 — Brief**
- Lee propietario + edificio + `building_analysis` + `building_owners`.
- 4 variables mínimas: edad (`owners.metadatos->>'edad'` o derivada de DNI/año nacimiento), influenciadores (`owner_relations`/notas IA), zona socioeconómica (de `madrid_barrio_clusters` por dirección particular del propietario), `pct_propiedad`.
- Historial (`hubspot_communications` + `calls` últimos 12 meses).
- Tipología actual (`owners.tipologia`) + gancho sugerido (de `building_analysis.banderas` + heurística).
- Card "Consejo Voss" → llama `agent_voss_coach` modo `brief`.

**Paso 2 — Guía en llamada**
- Checklist editable de info a extraer (tipología, motivación, datos del edificio, alquileres actuales). Estado persistido en `calls.metadatos->>'checklist'` o tabla nueva `call_session` (preferido: tabla `call_sessions` con estado en curso).
- Objetivo de cierre: radio (WhatsApp, link pixel, reunión).
- Cronómetro visible (no graba; sólo orientativo).

**Paso 3 — Post-llamada**
- Resultado: enum (`interesado`, `seguir`, `descartar`, `no_contesta`).
- Próxima acción sugerida con cadencia automática:
  - `interesado` → +1 semana
  - `seguir` → +1 mes
  - `descartar` → archivar; sin tarea
  - `no_contesta` → +3 días, max 3 reintentos antes de pasar a +1 mes
- Crea fila en `building_tasks` con `due_at` calculado y tipo `siguiente_llamada`.
- Llama `agent_voss_coach` modo `post` con la transcripción si ya existe; si no, sólo guarda el resultado.

Tabla nueva `call_sessions`:
`id, owner_id, building_id, comercial_id, paso int, checklist jsonb, objetivo text, resultado text, voss_brief jsonb, voss_post jsonb, started_at, closed_at`.
Grants `authenticated` + RLS por `comercial_id = auth.uid()` (con bypass de service_role).

---

## 3. KPIs automáticos por comercial

Vista `v_kpis_comercial_semana`:
- A partir de `calls` (ya tienen `analisis_ia` y `duracion`), `building_tasks`, `whatsapp_messages`, `next_actions`, `building_owners`.
- Por comercial × semana:
  - n_llamadas, pct_mas_60s
  - calidad_media (de `calls.analisis_ia->>'calidad'`)
  - tipologia_extraida (% con `owners.tipologia not null` tras llamada)
  - info_extraida (% checklists completos en `call_sessions`)
  - whatsapp_o_pixel (% llamadas con envío posterior)
  - seguimientos_al_dia (`building_tasks` no vencidas / total asignadas)
  - cobertura (`building_owners` contactados ÷ total por edificio asignado)
  - hs_poblado (% deals con campos clave rellenos)
  - reuniones, oportunidades (de `next_actions.tipo`)

Página nueva `/admin/ranking` (admin role) con tabla ordenable por cada KPI, semana actual y trend chip vs semana anterior. Panel propio del comercial en `Productividad.tsx` ("Mis KPIs").

---

## 4. Asignación automática de tareas

Edge function `assign_daily_call_queue` (programada con `pg_cron` 06:00 hora Madrid):
- Para cada `profile` con rol `comercial`:
  - Selecciona N=20 propietarios candidatos (de `building_owners` JOIN `building_assignments`) ordenados por `score_edificio × score_owner × (1 + dias_cadencia_vencida)`.
  - Alterna 60/40 calientes/fríos (score > 70 vs ≤ 70) para anti-burnout.
  - Inserta en `building_tasks` (tipo=`llamada_diaria`, `due_at=today`, `payload={owner_id,building_id,prioridad}`).

UI: en Dashboard del comercial, card "Cola de hoy" con botón **"Siguiente llamada"** que abre `/wizards/preparar/{owner_id}` directamente al paso 1.

---

## 5. Coach Voss

Edge function `agent_voss_coach`:
- Body: `{ mode:'brief'|'post', owner_id, building_id, call_transcript? }`.
- RAG: usa `generate_embeddings` ya existente sobre el texto query; busca top-6 en `knowledge_chunks` WHERE `source IN ('correo_chris_voss','libro_voss')` por similitud coseno (pgvector).
- Prompt Voss: `system` con principios (mirroring, label, calibrated questions, no/that's right, etc.).
- Salida estricta JSON: `{ tecnica_principal, sugerencia, por_que, fragmentos_usados:[{source,chunk_id,snippet}] }`.
- Modo `brief` usa snapshot del propietario; modo `post` usa transcripción + brief previo.

Integración UI:
- Paso 1 wizard: card "Consejo Voss" (brief).
- Paso 3 wizard: card "Análisis Voss post-llamada".
- Ficha de propietario (`/owners/:id`): botón "Coach Voss" que invoca modo `brief`.

NO toca scoring ni clustering.

---

## 6. Validación

Con un propietario de Topete 33:
1. Abrir `/wizards/preparar/{owner_id}`.
2. Mostrar brief con las 4 variables + gancho.
3. Mostrar respuesta de `agent_voss_coach`: técnica + sugerencia textual + 2 fragmentos del libro/correo.

---

## Detalles técnicos

- Migraciones nuevas: `call_sessions`, vistas `v_calls_baseline` y `v_kpis_comercial_semana`. Sin cambios RLS existentes; sólo políticas para las tablas nuevas.
- Edge functions nuevas: `agent_voss_coach`, `assign_daily_call_queue`. Cron en `pg_cron` con anon key (no datos sensibles en migración — usar `supabase--insert`).
- Reescritura prompt `agent_analyze_feedback` + ampliación whitelist `apply_feedback_override`.
- Nuevos componentes: `AprendizajePanel`, `BaselineLlamadas`, `RankingComercial`, `WizardPaso1/2/3`, `ColaHoy`, `VossCoachCard`.

## Fuera de alcance
- Coach Voss en tiempo real (durante la llamada).
- Reentreno automático sobre patrones de feedback.
- Asignación de territorio (sigue el `building_assignments` actual).
