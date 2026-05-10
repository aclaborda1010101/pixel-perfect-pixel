## Problema

`calls.owner_id` apunta al **propietario/lead** (contacto), no al **comercial asignado**. En HubSpot el comercial está en la propiedad `hubspot_owner_id` de la llamada (campo "Actividad asignada a"), que actualmente NO estamos sincronizando. Por eso el agrupado por "comercial" en `/productividad` muestra nombres de propietarios (FRANCISCA PAULA, JUAN AGUSTÍN…) en lugar de David, Miguel, Jesús y Cristina.

## Solución (4 fases encadenadas)

### Fase 1 — Backend: capturar comercial real desde HubSpot

**1.1 Migration** (idempotente, sin tocar datos):
- `hubspot_calls`: añadir `hs_owner_id text`, índice `(hs_owner_id)`.
- Nueva tabla `hubspot_owners` (catálogo de comerciales HubSpot):
  - `hs_owner_id text PK`, `email text`, `first_name text`, `last_name text`, `full_name text`, `archived boolean`, `raw jsonb`, `synced_at timestamptz`.
  - RLS preview-all + service write.
- `calls`: añadir `comercial_hs_id text`, `comercial_email text`, `comercial_nombre text`, índice `(comercial_hs_id, fecha)`.
- `coach_reports`: añadir `comercial_hs_id text` (UNIQUE `(comercial_hs_id, week_start)` además del actual por owner_id).

**1.2 Sync: añadir `hubspot_owner_id` a `PROPS.calls`** en `hubspot_sync_engagements` y persistirlo en `hubspot_calls.hs_owner_id`.

**1.3 Edge function nueva `hubspot_sync_owners`**:
- GET paginado de `/crm/v3/owners` (tiene email + firstName + lastName).
- Upsert en `hubspot_owners`.

**1.4 Re-sync**:
- `hubspot_sync_owners` → poblar catálogo (~10 filas).
- `hubspot_sync_engagements?type=calls&reset=true` encadenado → repobla `hubspot_calls.hs_owner_id` (5.914 filas).

### Fase 2 — Backfill `calls.comercial_*`

**Edge function `backfill_calls_comercial`** (one-shot, idempotente, encadenable):
- Para cada `calls` con `[hs:<id>]` en `resumen` → lee `hubspot_calls.hs_owner_id` por hs_id → JOIN con `hubspot_owners` → escribe `comercial_hs_id`, `comercial_email`, `comercial_nombre`.
- Procesa 1.000 por chunk, persiste cursor en `hubspot_sync_state` (entity=`backfill_calls_comercial`), self-chain hasta done.

Además, actualizar `promote_calls` para que en futuras promociones rellene los 3 campos directamente.

### Fase 3 — Frontend `/productividad` por comercial real

- Cambiar todos los agregados/dropdown/tabla en `Productividad.tsx`:
  - El `Select` "Comercial" pasa a listar entradas únicas de `calls.comercial_hs_id` (con `comercial_nombre`).
  - El filtro `selOwner` aplica sobre `comercial_hs_id`.
  - La **tabla comparativa** agrupa por `comercial_hs_id`.
  - Los heatmaps y KPIs siguen igual pero filtrados por comercial real.
- Manejo de "sin asignar": filas con `comercial_hs_id IS NULL` agrupadas como "—".

### Fase 4 — Coach IA por comercial real

- `generate_coach_report`:
  - Cambia clave de agregación de `owner_id` → `comercial_hs_id`.
  - Selecciona comerciales activos desde `calls.comercial_hs_id` (no desde lista de propietarios).
  - UPSERT por `(comercial_hs_id, week_start)`.
- UI tab "Coach IA" muestra tarjetas por comercial real (David, Miguel, Jesús, Cristina) con su `comercial_nombre`.
- Disparo manual: borrar reportes previos de la semana actual + regenerar → mostrar 1 ejemplo en el reporte final.

### Reglas

- HubSpot read-only (cero writes).
- Idempotencia en migration, backfill y upserts.
- No se toca `owners.id` ni la relación con propietarios; solo añadimos columnas nuevas a `calls`.
- Self-chaining con cursor en cualquier batch que pueda timeout.
- Sin avanzar a E.1 hasta tu confirmación final.

### Reporte final que te entregaré

1. Owners HubSpot sincronizados (esperado ~10, con David / Miguel / Jesús / Cristina identificados por email).
2. % de `calls` con `comercial_hs_id` resuelto (esperado ~95%+, las que tenemos hs_id).
3. Tabla comparativa real con los 4 comerciales: nº calls, conversión, sentiment, score técnica.
4. Reporte coach generado para cada uno + fragmento de ejemplo.

¿Apruebo y arranco?