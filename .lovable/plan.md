## Indicador de nota simple en fichas de edificio

### Objetivo
Añadir un indicador visual claro que muestre si un edificio tiene nota simple asociada o no, tanto en la lista de edificios como en la ficha de detalle.

### Cambios planificados

1. **Nuevo componente reutilizable `NotaSimpleBadge.tsx`**
   - Lógica: considera "con nota simple" si `buildings.metadatos->>'tenemos_la_nota_simple_'` es `"Sí"` o si existen registros en `notas_simples` vinculados al edificio.
   - Visual: badge verde (`success`) con icono de documento cuando hay nota; badge ámbar/destructivo con icono de alerta cuando falta. Tooltip breve.

2. **Lista de edificios (`src/pages/comercial/Edificios.tsx`)**
   - Añadir `metadatos` a `B_COLS` para leer `tenemos_la_nota_simple_` sin petición extra.
   - Añadir campo `has_nota_simple` al tipo `Row`.
   - Incluir `NotaSimpleBadge` en la fila de chips de cada tarjeta, junto a `DocAlertBadge` y `AlarmChips`.
   - Añadir filtro avanzado: "Con nota simple" / "Sin nota simple" / "Todos".

3. **Ficha de detalle (`src/pages/comercial/EdificioDetalle.tsx`)**
   - En la query principal, añadir un SELECT de `notas_simples` (id, status) filtrado por `building_id` para confirmar la existencia real.
   - Mostrar `NotaSimpleBadge` en las acciones del `PageHeader`, junto a `DocAlertBadge` y `AlarmChips`.

4. **Consideraciones de rendimiento**
   - El listado usará el metadato del edificio para evitar una consulta extra por tarjeta. La ficha usará `notas_simples` directamente (una sola query por edificio, cacheada por React Query).
   - No se toca scoring, sincronización, ni backend de HubSpot.

### No incluye
- Reescritura de `DocAlertBadge` (se mantiene como aviso de documentación faltante).
- Cambios en la base de datos o RLS.
- Nueva página ni navegación.
