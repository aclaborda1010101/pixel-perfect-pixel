## Diagnóstico (datos reales)

| Métrica | Valor |
|---|---|
| `hubspot_calls` totales en local | 5.914 |
| Última sync de `calls` en `hubspot_sync_state` | **2026-05-10** (hace ~36 días) |
| `hubspot_calls` con `hs_timestamp > 10-may` | **0** ← sync incremental parado |
| `calls` locales totales / promovidas desde HS | 5.559 / 5.517 |
| `hubspot_calls` **sin** `associated_contact_ids` | **367** (promote_calls las salta) |
| Cohort 77 — edificios con `building_owners` | 73/77 (4 sin owner) |
| Cohort 77 — owners distintos | 502 |
| Cohort 77 — owners con `external_ids → hubspot:contact` | **405/502** (97 huérfanos) |
| Cohort 77 — `calls` locales atadas | 509 (última 12-jun, vía `finalize_call_session`) |

Hay **tres fugas** que explican lo que ves:

1. **Sync de `hubspot_calls` parada desde 10-may** → toda llamada hecha en HubSpot después de esa fecha no entra al sistema. Solo entran las que se cierran a mano desde la app (`finalize_call_session`).
2. **367 llamadas en HubSpot sin contacto asociado** → `promote_calls` las descarta porque no sabe a qué `owner` atarlas (solo mira `associated_contact_ids[0]`).
3. **97 owners del cohort sin `external_ids` a su contacto de HubSpot** → aunque la llamada esté en `hubspot_calls`, no se enlaza con el owner correcto, por lo que no aparece bajo su edificio.

## Plan

### 1. Reanudar el sync de llamadas de HubSpot (cierra fuga #1)
- Invocar `hubspot_sync_engagements` con `entities: ['calls']` y `reset: true` para forzar paginado completo y refrescar `total_synced`.
- Trocear con `max_pages` y auto-reinvocación si el run inicial no agota la paginación; reportar `pages_fetched / upserted / failed` por iteración hasta que `cursor` quede vacío.
- Verificar: `SELECT COUNT(*) FROM hubspot_calls WHERE hs_timestamp > '2026-05-10'` debe pasar de 0 a N>0.

### 2. Promover el delta a `calls` (cierra fuga #1 hacia la app)
- Invocar `promote_calls` en bucle hasta que `promoted=0`.
- Reportar `promoted / skipped_no_owner / skipped_existing / failed`.

### 3. Rescatar llamadas sin contacto (cierra fuga #2)
Ampliar `promote_calls` con tres rutas de fallback **en este orden**, solo para filas donde el contacto principal no resuelve owner:

```text
a) associated_deal_ids[0] → external_ids(entity_type='deal') → deal → building → owner principal de ese building (building_owners ordenado por porcentaje/principal)
b) hs_call_to_number / hs_call_from_number normalizado → owners.telefono
c) hubspot_owner_id (comercial) + ventana temporal → última call_session abierta de ese comercial
```

Cada fila promovida vía fallback marca `resumen` con `[hs:<id>][via:deal|tel|session]` para auditar. Si ninguna ruta resuelve, queda en `skipped_no_owner` y se vuelca a un view `v_hubspot_calls_huerfanas` para revisión manual.

### 4. Backfill de los 97 owners huérfanos del cohort (cierra fuga #3)
- Ejecutar `backfill_orphan_contacts` limitado al cohort 77 (los 502 owners).
- Para cada owner sin `external_ids`, buscar en `hubspot_contacts` por email exacto → teléfono normalizado → nombre+CIF; insertar en `external_ids`.
- Tras el backfill, re-lanzar `promote_calls` (paso 2) para enganchar las calls que antes quedaban sueltas.

### 5. Reporte por edificio del cohort
Crear/actualizar `v_cohort77_calls_audit` con columnas:

| campo | descripción |
|---|---|
| building_id, direccion | id y calle |
| owners_total / owners_con_hs | mapeo HS del owner |
| calls_locales | `calls` atadas vía `building_owners → owner_id` |
| hs_calls_esperadas | `hubspot_calls` cuyo contacto/deal/teléfono apunta a ese building |
| gap | esperadas − locales |
| ultima_call_local / ultima_call_hs | timestamps para detectar desfase |

Tras los pasos 1–4 imprimir filas con `gap > 0` (deberían ser 0 o muy pocas).

### 6. Tarea programada (prevención)
- Confirmar/crear un cron diario que invoque `hubspot_sync_engagements({entities:['calls']})` + `promote_calls`. Si ya existía y está parado, reactivarlo y avisar.

## Detalles técnicos

- Archivos a tocar: `supabase/functions/promote_calls/index.ts` (fallbacks), nueva migración con `v_cohort77_calls_audit` y `v_hubspot_calls_huerfanas`. `hubspot_sync_engagements` y `backfill_orphan_contacts` se reutilizan tal cual.
- Idempotencia conservada: `promote_calls` sigue marcando `[hs:<id>]` en `resumen`.
- No se toca `calls` schema ni RLS; todo es inserción/lectura.
- Reportes (counts, gap por edificio) en chat al terminar cada paso.

## Qué NO hace este plan
- No re-sincroniza notas/tareas (solo `calls`).
- No reescribe el scoring de llamadas (eso ya está en marcha).
- No crea owners nuevos: si una `hubspot_calls` no tiene contacto **ni** deal **ni** match por teléfono, queda listada en `v_hubspot_calls_huerfanas` para que tú decidas.
