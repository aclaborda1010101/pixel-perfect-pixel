# Plan F2 — Correcciones del equipo con aprendizaje

## Pre-paso (background)
Disparar `hubspot_sync_associations` para los 77 edificios pendientes (deals→companies, companies→contacts) en modo background antes de empezar el bloque F2. Sin bloquear el resto del plan.

## 1. Esquema BD

Nueva tabla `building_feedback`:

```text
id uuid pk
building_id uuid fk -> buildings
autor_id uuid (auth.uid)
autor_email text
canal text check in ('voz','texto')
texto text                       -- transcrito si voz
audio_url text                   -- storage://feedback-audio/...
dimension text                   -- escaleras|ventanas|proteccion|cluster|propietarios|m2|viviendas|otro
estado text default 'nueva'      -- nueva|analizada|aplicada|descartada|requiere_codigo
analisis_ia jsonb                -- {diagnostico, origen_dato_actual, accion_propuesta, override_payload, constante_sugerida}
override_aplicado jsonb          -- {campo, valor_anterior, valor_nuevo, aplicado_en, aplicado_por}
created_at, updated_at
```

Grants + RLS: SELECT/INSERT/UPDATE para `authenticated`; ALL para `service_role`. Sin cambios en RLS de otras tablas.

Bucket privado `feedback-audio` (Storage).

Reutilizar `scoring_v2_feedback` (ya existe) como matriz QA: añadir trigger que, al pasar `building_feedback.estado='aplicada'`, inserta una fila en `scoring_v2_feedback` con el override y el building_id como caso de regresión.

## 2. UI — card "Correcciones del equipo"

En `src/pages/comercial/EdificioDetalle.tsx` y `src/pages/BuildingDetail.tsx`: nuevo componente `<TeamFeedbackCard buildingId={...} />` con:

- Botón grabar (MediaRecorder, mismo flujo que `transcribe_call`): graba → sube a `feedback-audio` → invoca `transcribe_call` → crea row `canal='voz'` con texto transcrito.
- Textarea + botón "Enviar observación" → crea row `canal='texto'`.
- Lista de feedbacks del edificio (desc) mostrando: autor, fecha, texto, badge de dimensión, badge de estado, panel expandible con `analisis_ia` (diagnóstico + acción propuesta).
- Si `accion_propuesta.tipo === 'override'`: botón "Aplicar override" (1-click) que llama edge function `apply_feedback_override` → actualiza el campo correspondiente en `building_analysis` / `buildings` / `catastro_authority_cache`, marca estado `aplicada`, dispara `recompute-cluster-scoring` para ese edificio.
- Si `tipo === 'constante'`: botón "Ajustar constante" (sólo admins) que edita `app_settings`.
- Si `tipo === 'requiere_codigo'`: badge rojo "Requiere cambio de código".

## 3. Edge function `agent_analyze_feedback`

Trigger: al INSERT en `building_feedback` (vía trigger DB → `pg_net.http_post`, o invocación directa desde el cliente tras insertar — usar invocación cliente para simplicidad).

Lógica:

1. Cargar feedback + snapshot completo del edificio (`building_analysis`, `catastro_authority_cache`, `facade_window_counts`, `building_owners`, score actual, banderas).
2. Llamar a Lovable AI (`google/gemini-3-flash-preview` con `Output.object`) con prompt:
   - Clasifica `dimension` (enum cerrado).
   - Identifica el campo concreto afectado y su valor actual y origen (VLM/catastro/heurística/HubSpot).
   - Diagnostica por qué el sistema falló (compara texto del usuario con datos).
   - Propone una de tres acciones:
     - `override`: `{ tabla, campo, valor_nuevo, justificación }`
     - `constante`: `{ key en app_settings, valor_nuevo, justificación }`
     - `requiere_codigo`: `{ descripción técnica, módulo afectado }`
3. Guarda en `analisis_ia`, marca `estado='analizada'`.

## 4. Edge function `apply_feedback_override`

Aplica el override del payload, escribe `override_aplicado`, marca `estado='aplicada'`, llama `recompute-cluster-scoring` con el `building_id`. El trigger de regresión copia a `scoring_v2_feedback`.

## 5. Aprendizaje — pantalla admin

Ruta `/settings/aprendizaje` (`AprendizajePanel.tsx`):

- KPIs: nº feedbacks por dimensión, % aplicados vs descartados, tiempo medio de análisis.
- Tabla "Patrones detectados": agrupa por `dimension` + `analisis_ia.causa_raiz`; muestra ej. "VLM falla escaleras en planos B/N (12 casos)".
- Cola "Requiere cambio de código": destacada para revisión por ingeniería.
- Botón "Resumen IA semanal": llama edge function que genera sugerencias de mejora agregadas.

## 6. Notificaciones dashboard

En `Dashboard.tsx` admin: badge rojo con contador de feedbacks `estado='requiere_codigo'` no atendidos, link directo a la cola.

## 7. Validación

Crear feedback de prueba por texto en Topete 33: "la protección existe, está en el APE de Bellas Vistas". Mostrar el `analisis_ia` resultante:
- dimensión: `proteccion`
- diagnóstico esperado: ArcGIS layer 5 no cubre APE distritales; fallback fuzzy no encontró match
- acción: `override` con `building_analysis.protegido=true` + `protegido_raw.manual_ape='Bellas Vistas'`, o `requiere_codigo` si se decide integrar la capa APE.

## Detalles técnicos

- Migración SQL: `building_feedback` + grants + RLS + trigger de regresión.
- Storage: bucket `feedback-audio` privado con políticas (insert authenticated, select autor o admin).
- Edge functions nuevas: `agent_analyze_feedback`, `apply_feedback_override`, `learning_weekly_summary`.
- Reutiliza `transcribe_call` existente para STT.
- UI: nuevo componente `TeamFeedbackCard` + página `AprendizajePanel`.
- Sin cambios a RLS existente; sin tocar `auth`/`storage` schemas más allá del bucket nuevo.

## Fuera de alcance
- Reentreno automático de modelos (sólo recolectamos matriz QA).
- Capa APE distrital de PGOU (queda como `requiere_codigo` si surge).
- Edición colaborativa en tiempo real de feedbacks.
