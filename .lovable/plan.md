# Inventario de tareas programadas (cron) — reconstrucción desde código

Sin SQL, sin cambios, sin despliegues. Todo lo de abajo sale de leer el repositorio.

## Advertencia importante sobre las fuentes

En el repositorio **solo hay 2 tareas programadas versionadas**:

- `supabase/migrations/20260630130000_wa_ai_jobs_reaper.sql:16` → `cron.schedule('wa-ai-jobs-reaper-1min','* * * * *', ...)` llamando a `/functions/v1/wa_ai_jobs_reaper`.
- `supabase/migrations/20260721095548_...sql:115` → `cron.schedule('link_orphan_contacts_10m','*/10 * * * *', ...)` llamando a `/functions/v1/link_orphan_contacts`.
- Además, `supabase/migrations/20260616035630_...sql:2-8` desprograma 7 tareas antiguas (`coach-weekly`, `analyze-daily`, `transcribe-daily`, `generate-embeddings-hourly`, `learn_from_calls_daily`, `sync_hubspot_calls_to_sessions_10min`, `reprocess-cohort-77-watchdog`).

**El resto de las tareas se crearon directamente contra la base (no están en migraciones versionadas).** Por tanto su horario y su cuerpo exacto **no pueden confirmarse offline**; el mapeo de abajo combina el listado de nombres/horarios que sí llegué a leer antes de que la base empezara a cancelar consultas, con el código de cada función en `supabase/functions/`. Cuando la base vuelva a responder habrá que verificar el cuerpo real de cada job.

## Las 2 tareas de cada minuto (`* * * * *`)

| Job | Función | Qué hace | Escribe | Coste |
|---|---|---|---|---|
| `wa-ai-jobs-reaper-1min` | `wa_ai_jobs_reaper` | Recupera respuestas de WhatsApp con IA encalladas | Sí | Bajo-medio (llama IA si hay pendientes) |
| `wa-conversation-email-dispatcher` | `wa_conversation_email_dispatcher` | Envía por email los resúmenes de conversación | Sí | Bajo, pero envía correo |
| `finalize_pending_retries_1m` | `finalize_pending_retries` | Reintenta cierres de llamada; hasta **20 invocaciones encadenadas** de `finalize_call_session` por pasada (`finalize_pending_retries/index.ts:15-31`) | Sí | **Alto**: cada reintento dispara IA y escrituras |

Nota: son **3**, no 2, con expresión `* * * * *`. `finalize_pending_retries_1m` es el más caro de los tres con diferencia.

## Las tareas de cada 5 minutos (`*/5 * * * *`)

| Job | Función | Finalidad | Escribe | Coste |
|---|---|---|---|---|
| `transcribe_calls_drain` | `transcribe_calls` | Transcribe audio de llamadas (STT externo) | Sí | **Muy alto** (audio + IA) |
| `auto_analyze_hubspot_calls_5m` | `auto_analyze_hubspot_calls` | Analiza llamadas con IA | Sí | **Muy alto** |
| `audit_calls_retro_every_5m` | `audit_calls_retro` | Auditoría retroactiva del histórico (~1.300 llamadas) | Sí | **Muy alto**, es un backfill disfrazado de cron |
| `hubspot_sync_incremental_5m` | `hubspot_sync_incremental` | Sincroniza llamadas/notas/tareas/reuniones de HubSpot; hasta 20 páginas × 100 registros por tipo y **una petición extra de asociaciones por registro** (`hubspot_sync_incremental/index.ts:112-125,156-201`); además encadena transcripción y análisis (línea 266-283) | Sí | **Alto** |
| `detect_whatsapp_consent_5m` | `detect_whatsapp_consent` | Detecta consentimiento con LLM | Sí | Medio-alto |
| `notas_simples_reparse_5m` | `notas_simples_reparse` | Relee PDFs de notas simples con visión IA (431 líneas, el proceso más pesado por documento) | Sí | **Muy alto** |
| `wa-replay-deferred-open` | `wa_replay_deferred` | Reenvía mensajes diferidos, sólo 6-9h L-V | Sí | Bajo |
| `hubspot_deals_inc_15m` / `hubspot_contacts_inc_15m` / `promote_hubspot_metadata_15m` | varias | Sincronización incremental cada 15 min | Sí | Medio |
| `wa-match-backfill-every-10min`, `link_orphan_contacts_10m`, `auto_link_owner_building_10m` | varias | Emparejado y enlazado de contactos | Sí | Medio (consultas de similitud, caras en CPU) |

## Otras activas (menos frecuentes)

`wa_followups_hourly`, `notas_simples_attach_hourly` (`:10`), `notas_simples_ingest_hourly` (`:25`), `hubspot_companies_inc_60m` (`:07`), `guardas_detect_hourly` (`:07`), `mantenimiento_datos_1h` (`:07`), `integrity_watchdog_30m` (`:02` y `:32`), `notas_por_deal_gemelo_6h`, y las nocturnas `iee-batch-nightly` (03:30), `whatsapp_daily` (04:45), `stale-daily` (07:00), `hygiene-daily` (07:15).

Inactivas ya: `contacts_backfill_tmp`, `notas_ingest_drain_tmp`.

Detalle a vigilar: **tres jobs coinciden en el minuto :07 de cada hora** (`hubspot_companies_inc_60m`, `guardas_detect_hourly`, `mantenimiento_datos_1h`) — pico de carga sincronizado cada hora.

## Clasificación

### A) Pausar primero (riesgo bajo, ahorro alto)
1. `audit_calls_retro_every_5m` — es un backfill histórico, no necesita tiempo real.
2. `notas_simples_reparse_5m` — visión IA sobre PDFs; ya de por sí es el proceso más lento y con cola de reintentos.
3. `transcribe_calls_drain` — STT costoso; la cola se conserva y se drena después.
4. `auto_analyze_hubspot_calls_5m` — el análisis puede esperar unas horas.
5. `finalize_pending_retries_1m` — cada minuto lanzando hasta 20 cierres encadenados.
6. `detect_whatsapp_consent_5m` — clasificación diferible.

Nada de esto pierde datos: todos trabajan sobre colas persistentes con claves de idempotencia y reintentos, así que al reanudarlos recuperan lo pendiente.

### B) Espaciar, no apagar
- `hubspot_sync_incremental_5m` → pasar a cada 15-30 min y reducir `pages`. Es el que mantiene el CRM al día, pero su coste por pasada es alto por las peticiones de asociaciones una a una.
- `wa-match-backfill-every-10min`, `auto_link_owner_building_10m`, `link_orphan_contacts_10m` → a 30-60 min.
- `hubspot_deals_inc_15m`, `hubspot_contacts_inc_15m`, `hubspot_companies_inc_60m`, `promote_hubspot_metadata_15m` → mantener pero desplazar minutos para que no coincidan.
- `integrity_watchdog_30m` → a cada hora mientras dure la incidencia (si no, avisará de fallos causados por la propia pausa).

### C) Mantener
- `wa-ai-jobs-reaper-1min` y `wa-conversation-email-dispatcher` → afectan a conversaciones vivas con clientes; baratos.
- `wa_followups_hourly`, `wa-replay-deferred-open` → contacto con cliente en horario comercial.
- Nocturnas (`iee-batch-nightly`, `whatsapp_daily`, `stale-daily`, `hygiene-daily`) → fuera de hora punta, no compiten.

No conviene pausar **toda** la sincronización de HubSpot: dejar al menos `hubspot_sync_incremental` (espaciado) y `hubspot_contacts_inc`, o los cursores se atrasarán y la recuperación posterior será un lote mucho más pesado.

## Qué no puedo confirmar offline

- El cuerpo SQL real y el horario vigente de los ~27 jobs no versionados (sólo 2 están en migraciones).
- El historial de ejecuciones (`cron.job_run_details`) y cuáles están fallando o solapándose ahora mismo: esa consulta es precisamente una de las que se cancela.
- Si alguna pasada está solapándose consigo misma (varias instancias del mismo job a la vez), que sería el agravante más probable en `transcribe_calls_drain`, `audit_calls_retro` y `notas_simples_reparse`.

## Siguiente paso propuesto

Cuando lo autorices, pausar el grupo A (acción reversible, sin tocar datos) y reprogramar el grupo B. Hasta entonces no ejecuto nada.
