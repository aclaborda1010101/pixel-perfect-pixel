## Objetivo
Cuando entra un WhatsApp, intentar identificar el teléfono contra `owners.telefono` de nuestra base y, si hay match, mostrar el propietario y los edificios asociados directamente en el panel de WhatsApp.

## Alcance (solo esto)
- Match teléfono → owner (1 sola coincidencia) → edificios vía `building_owners`.
- Persistir el match en `wa_contacts.lead_id` (FK ya existe a `owners.id`) y guardar los `building_ids` en `wa_contacts.metadata.matched_buildings` para no repetir lookups.
- Visualizarlo en la ficha derecha de la conversación en `src/pages/whatsapp/WhatsappDashboard.tsx` (no en listados globales).

No se toca: scoring, escaleras, bot AI, mapping HubSpot, ranking, ni la lógica de roles.

## Cambios

### 1. Helper SQL `match_owner_by_phone(p_phone text)`
Migración con función `security definer` que:
- Normaliza ambos lados a últimos 9 dígitos (`regexp_replace` + `right(...,9)`).
- Devuelve `owner_id` solo si hay **exactamente 1** owner con ese teléfono (evita falsos positivos cuando dos owners comparten móvil).
- Devuelve también `owner_nombre` y array de `building_id, direccion` desde `building_owners` + `buildings`.

GRANT EXECUTE a `authenticated` y `service_role`.

### 2. Auto-match en `evolution_webhook/index.ts`
Tras el `upsert` en `wa_contacts` (línea 78–80), si el contacto no tiene `lead_id` aún:
- Llamar a `match_owner_by_phone(phone)`.
- Si hay match único: `update wa_contacts set lead_id = ..., metadata = metadata || {matched_buildings: [...], matched_at: now()}`.
- Si 0 o ≥2 matches: dejar `lead_id` null y guardar `metadata.match_status = 'none' | 'ambiguous'` para que la UI lo muestre como tal.

Idempotente: no reintenta si ya hay `lead_id` o si `metadata.matched_at` < 7 días.

### 3. Edge function `wa_match_backfill`
One-off (con botón en `JobsManualPanel`) que recorre `wa_contacts` sin `lead_id` y aplica el mismo match para los 3986 owners con teléfono ya existentes en la base.

### 4. UI en `WhatsappDashboard.tsx`
En la ficha derecha de la conversación (donde se muestran nombre/teléfono y rol), añadir un bloque "Identificado en BD":
- Si `lead_id` está poblado: nombre del owner como link a `/owners/:id`, y lista de edificios (máx 3 + "ver más") con link a `/comercial/edificios/:id`.
- Si `match_status='ambiguous'`: aviso discreto "Varios propietarios con este teléfono — revisar".
- Si nada: no mostrar el bloque.

Datos: ampliar el `select` de la query principal para incluir `wa_contacts.lead_id, wa_contacts.metadata`, y un join lateral / segunda query a `owners` + `building_owners` + `buildings` solo del contacto seleccionado (no de la lista para no penalizar).

## Archivos
- nueva migración (función SQL + grants)
- `supabase/functions/evolution_webhook/index.ts` (auto-match)
- `supabase/functions/wa_match_backfill/index.ts` (nuevo)
- `src/components/settings/JobsManualPanel.tsx` (botón backfill)
- `src/pages/whatsapp/WhatsappDashboard.tsx` (bloque "Identificado en BD")

## Pregunta
Ambigüedad (≥2 owners con el mismo teléfono): ¿lo dejo como aviso "revisar" sin asociar, o prefieres que asocie igualmente al más reciente y marque "posible"?
