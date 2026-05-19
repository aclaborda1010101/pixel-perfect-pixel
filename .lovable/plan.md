## Findings

### (a) Dónde se construye la lista de properties del sync
- **Ruta exacta:** `supabase/functions/_shared/hubspot.ts`
- **Línea exacta del array:** `38`
- **Uso en el sync:** `supabase/functions/hubspot_sync_deals/index.ts:77-80`
  - `DEAL_PROPERTIES.forEach((p) => params.append('properties', p));`
  - `const data = await hubspotFetch(`/crm/v3/objects/deals?${params.toString()}`);`
- **Conclusión:** el sync de deals actual usa **GET `/crm/v3/objects/deals`**, no `POST /crm/v3/objects/deals/search`.

### (b) Array literal de propiedades que se está pidiendo ahora mismo
```ts
[
  'dealname', 'dealstage', 'pipeline', 'amount', 'address',
  'createdate', 'hs_lastmodifieddate', 'closedate', 'hubspot_owner_id',
  'num_associated_contacts', 'hs_deal_stage_probability',
  'hs_is_closed', 'hs_is_closed_won', 'hs_is_closed_lost', 'hs_closed_won_count',
  'hs_days_to_close_raw', 'hs_v2_time_in_current_stage', 'hs_forecast_amount',
  'hs_v2_date_entered_current_stage',
  'referencia_catastral',
  'metros_cuadrados__exactos_',
  'dividido',
  'verificado',
  'tenemos_la_nota_simple_',
  'prioridad_del_activo',
  'distrito_zona__clonada_',
  'barrios_completos__clonada_',
  'tipo_de_activo___inmueble__clonada_',
  'tipo_de_oportunidad__clonada_',
  'valoracion_viviendas',
  'valoracion_locales',
  'precio_del_vendedor__exacto___clonada_',
  'precio_del_vendedor__rango___clonada_',
  'metros_cuadrados__rango_',
  'viviendas__unidades_',
  'metros_cuadrados_viviendas',
  'comercio__unidades_',
  'metros_cuadrados_comercio',
  'oficina__unidades_',
  'metros_cuadrado_oficina',
  'almacen__unidades_',
  'metros_cuadrados_almacen',
  'aparcamiento__unidades_',
  'elementos_comunes__unidades_',
  'metros_cuadrados_elementos_comunes',
  'ocio_hostel__unidades_',
  'metros_cuadrados_ocio_hostel',
  'industrial__unidades_',
  'metros_cuadrados_industrial',
]
```
- **Sí está** `viviendas__unidades_`
- **No está** `viviendas__unidades___clonada_`

### (c) Log real del último run del sync de deals
He leído el log persistido en `hubspot_sync_log` / `hubspot_sync_state`.

- **Último run:** `e7aaec8e-6f01-4723-99e5-8992d1d3b97e`
- **Started:** `2026-05-18 06:28:41.55833+00`
- **Finished:** `2026-05-18 06:28:42.046+00`
- **Status interno del sync:** `error`
- **Pages fetched:** `0`

**Cuerpo literal guardado en `error_message` / `last_error`:**
```text
HubSpot /crm/v3/objects/deals?limit=100&archived=false&properties=dealname&properties=dealstage&properties=pipeline&properties=amount&properties=address&properties=createdate&properties=hs_lastmodifieddate&properties=closedate&properties=hubspot_owner_id&properties=num_associated_contacts&properties=hs_deal_stage_probability&properties=hs_is_closed&properties=hs_is_closed_won&properties=hs_is_closed_lost&properties=hs_closed_won_count&properties=hs_days_to_close_raw&properties=hs_v2_time_in_current_stage&properties=hs_forecast_amount&properties=hs_v2_date_entered_current_stage&properties=referencia_catastral&properties=metros_cuadrados__exactos_&properties=dividido&properties=verificado&properties=tenemos_la_nota_simple_&properties=prioridad_del_activo&properties=distrito_zona__clonada_&properties=barrios_completos__clonada_&properties=tipo_de_activo___inmueble__clonada_&properties=tipo_de_oportunidad__clonada_&properties=valoracion_viviendas&properties=valoracion_locales&properties=precio_del_vendedor__exacto___clonada_&properties=precio_del_vendedor__rango___clonada_&properties=metros_cuadrados__rango_&properties=viviendas__unidades_&properties=metros_cuadrados_viviendas&properties=comercio__unidades_&properties=metros_cuadrados_comercio&properties=oficina__unidades_&properties=metros_cuadrado_oficina&properties=almacen__unidades_&properties=metros_cuadrados_almacen&properties=aparcamiento__unidades_&properties=elementos_comunes__unidades_&properties=metros_cuadrados_elementos_comunes&properties=ocio_hostel__unidades_&properties=metros_cuadrados_ocio_hostel&properties=industrial__unidades_&properties=metros_cuadrados_industrial&after=34511676549 403: {"status":"error","message":"This app hasn't been granted all required scopes to make this call. Read more about required scopes here: https://developers.hubspot.com/scopes.","correlationId":"019e39c5-bd48-79a3-b9c7-ad7a7f49585b","errors":[{"message":"One or more of the following scopes are required.","context":{"requiredGranularScopes":["crm.schemas.deals.read","crm.objects.deals.read","crm.objects.deals.highly_sensitive.read.v2","crm.objects.deals.sensitive.read.v2"]}}],"links":{"scopes":"https://developers.hubspot.com/scopes"},"category":"MISSING_SCOPES"}
```

**Importante:**
- Esto **no es una inferencia** mía; ese string está guardado literalmente en base de datos por `hubspotFetch()` al lanzar el error en `supabase/functions/_shared/hubspot.ts:31-33`.
- **No he podido sacar edge logs enriquecidos** con más detalle: `supabase.edge_function_logs('hubspot_sync_deals')` no devolvió entradas y `analytics_query` tampoco devolvió filas para esa función. La evidencia real disponible está en la tabla de logs propia del proyecto.

### (d) Revisión de propiedades con patrón `_clonada_`
En `DEAL_PROPERTIES` hay **6** campos ya migrados a `_clonada_`:
1. `distrito_zona__clonada_`
2. `barrios_completos__clonada_`
3. `tipo_de_activo___inmueble__clonada_`
4. `tipo_de_oportunidad__clonada_`
5. `precio_del_vendedor__exacto___clonada_`
6. `precio_del_vendedor__rango___clonada_`

El bloque de “distribución de usos” sigue entero en nombres **no clonados**:
- `viviendas__unidades_`
- `metros_cuadrados_viviendas`
- `comercio__unidades_`
- `metros_cuadrados_comercio`
- `oficina__unidades_`
- `metros_cuadrado_oficina`
- `almacen__unidades_`
- `metros_cuadrados_almacen`
- `aparcamiento__unidades_`
- `elementos_comunes__unidades_`
- `metros_cuadrados_elementos_comunes`
- `ocio_hostel__unidades_`
- `metros_cuadrados_ocio_hostel`
- `industrial__unidades_`
- `metros_cuadrados_industrial`

Además, hay **consumidores aguas abajo** que hoy leen esos nombres antiguos en la vista `v_building_score`:
- `supabase/migrations/20260519040845_51b56d86-2319-4fdb-a6b7-17a91ba53c41.sql:11,61-74`
- `supabase/migrations/20260518041536_9219f5bf-573e-48ab-83a5-82cd8fe9ccb6.sql:11-14,46-59`

## Plan de fix propuesto

### Opción A — Sustituir el nombre antiguo por `_clonada_`
**Qué tocaría**
- `supabase/functions/_shared/hubspot.ts`
  - cambiar `viviendas__unidades_` por `viviendas__unidades___clonada_`
  - y, si confirmas los demás en HubSpot UI, repetir para el resto del bloque de usos
- `supabase/migrations/...v_building_score...sql`
  - actualizar la vista para leer `metadatos->>'viviendas__unidades___clonada_'`
  - idealmente revisar los demás campos de usos si también tienen versión `_clonada_`

**Pros**
- Lista de properties más limpia
- Menos payload por petición a HubSpot
- Fuente única y explícita

**Contras**
- Más frágil si en HubSpot conviven ambas o vuelven a renombrarlas
- Requiere conocer con certeza cada nombre interno `_clonada_`
- Si algún deal histórico solo conserva el nombre viejo, lo perderías en el mapping

### Opción B — Pedir ambas y hacer coalesce en el mapping
**Qué tocaría**
- `supabase/functions/_shared/hubspot.ts`
  - añadir `viviendas__unidades___clonada_` sin quitar `viviendas__unidades_`
  - mismo patrón para el resto del bloque si existen clones
- `supabase/migrations/...v_building_score...sql`
  - cambiar a algo como coalesce entre `_clonada_` y el antiguo
  - por ejemplo para viviendas: primero `_clonada_`, luego la antigua, luego `num_viviendas`
- Si hay UI o queries directas contra `buildings.metadatos`, revisar también esos accesos

**Pros**
- Más robusta ante convivencia de nombres viejos/nuevos
- Menor riesgo de perder datos históricos
- Permite migración progresiva

**Contras**
- Más complejidad en mapping y vista
- Payload algo mayor
- Mantiene deuda técnica hasta consolidar nombres definitivos

## Recomendación
- **Recomiendo la Opción B** como fix inicial.
- Motivo: tú ya has validado que `viviendas__unidades___clonada_` es la propiedad buena en UI, pero el log real sigue mostrando un 403 global del endpoint; como coexistieron nombres viejos y nuevos, el enfoque con coalesce minimiza riesgo y no obliga a apostar todo a un único rename en la primera pasada.

## Detalles técnicos
- El 403 actual ocurre en la llamada global a `/crm/v3/objects/deals` antes de procesar ningún deal, así que hay **dos problemas potencialmente independientes**:
  1. la app/token/gateway devuelve `MISSING_SCOPES` en ese endpoint concreto;
  2. aunque el endpoint volviera a responder, `viviendas__unidades_` seguiría apuntando al campo equivocado para Ferraz 36.
- O sea: **corregir a `_clonada_` arregla el mapping**, pero **no demuestra por sí solo** que el 403 desaparezca.
- También hay un posible typo a revisar después: `metros_cuadrado_oficina` (sin `s` en `cuadrado`).

## Implementación propuesta cuando salgas de plan mode
1. Añadir los nombres `_clonada_` del bloque de usos en `DEAL_PROPERTIES`.
2. Actualizar `v_building_score` para hacer coalesce `_clonada_` → antiguo.
3. Revisar si hay consultas directas a `metadatos` fuera de la vista.
4. Solo después, ejecutar un sync controlado y validar Ferraz 36 y cobertura global.