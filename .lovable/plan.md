# Plan: 5 pulidas post-piloto

Cinco cambios independientes. Ninguno toca el scoring de la BD.

## 1) "Por qué del score" breve en la ficha

Añadir en `ScoringResumen.tsx`, justo debajo del cluster/score header, una línea corta (1-2 frases) generada en cliente a partir de los datos ya cargados:

- Nº propietarios, nº viviendas, m² medios por vivienda, % terciario, protección.
- Ejemplo: *"Puntúa alto: 5 propietarios, 26 viviendas, 45 m²/viv medio, sin protección, 0% terciario."*
- Cuando score < 45, formulada en negativo: *"Puntúa bajo: 1 propietario, sin división horizontal, protección PGOU."*

Cero llamadas a IA — pura composición de strings sobre los campos que ya vienen en `s` y `b`. Se muestra siempre; el párrafo largo existente se mantiene fuera para no romper otras vistas.

## 2) Tipología: un solo perfil asignado

Localizar los sitios donde hoy se pinta `T5-T2` / `T9 T5 T2`:
- `agent_voss_coach` (prompt/salida del brief) y su componente `VossCoachCard.tsx`.
- Ficha del propietario (`OwnerDetail.tsx` y/o `PreCallBrief.tsx`).

Regla nueva:
- Si `owners.tipologia` (o campo equivalente único) está poblado → mostrar `T{n} · {nombre_perfil}`.
- Si la IA devuelve múltiples, coger el primero (más probable) y descartar el resto en UI.
- Si no hay ninguno → `"Sin clasificar (a confirmar en llamada)"`.

Mapa T1–T10 → nombre corto centralizado en `src/lib/tipologias.ts` (nuevo, pequeño).

## 3) Evidencia de KPI con cita de fecha/fuente

En `supabase/functions/agent_kpi_checklist/index.ts`:
- El prompt ya recibe corpus con prefijos `[LLAMADA fecha]`, `[NOTA HS fecha]`, `[WHATSAPP fecha]`, `[RESUMEN IA LLAMADA fecha]`.
- Reforzar en `sys` que la `evidencia` DEBE empezar por `"<fuente> <fecha>: «cita»"` (ej. `Llamada 12/06/2026: «puede escribirme al WhatsApp»`).
- Ampliar el schema del tool para incluir `fuente` y `fecha` opcionales además de `evidencia`.
- Renderizar en `KpiChecklistCard.tsx`: mostrar la cita completa con estilo de "fuente · fecha".

Especial foco en `whatsapp_abierto`: el system prompt ordena citar textualmente la autorización.

## 4) Backfill m²/año en ficha edificio

En `EdificioDetalle.tsx` (o el card de resumen que muestra los `—`):
- Si `m2_viviendas` viene vacío y `%terciario == 0` → mostrar `m2_total`.
- Si `año_construccion` viene vacío → intentar `catastro_authority_cache.ant` / `buildings.metadatos.año` / `catastro_data.año_construccion`.
- Derivar en cliente sin BD: fallback en cascada por los campos ya cargados.

No se hace fetch adicional; usa lo que ya devuelve la query de detalle. Si aun así no hay dato → conservar `—`.

## 5) Rendimiento lista de edificios

`src/pages/comercial/Edificios.tsx`:
- Reducir `select`: quitar columnas pesadas (metadatos, breakdown, avisos JSON) del listado, cargarlas solo en el detalle.
- Bajar `pageSize` inicial si está >50.
- Confirmar que `useTableQuery` ya usa `range()` (sí, lo hace).
- Añadir `placeholderData` (ya lo tiene).

En la ficha (`EdificioDetalle.tsx`):
- Marcar como `enabled: false` las queries pesadas hasta que se despliegue el bloque correspondiente (lazy sections).

## Archivos que se tocan

- `src/components/comercial/ScoringResumen.tsx` (1)
- `src/lib/tipologias.ts` (2, nuevo)
- `src/components/comercial/VossCoachCard.tsx` (2)
- `src/pages/OwnerDetail.tsx` o `PreCallBrief.tsx` (2, el que muestre tipología)
- `supabase/functions/agent_kpi_checklist/index.ts` (3)
- `src/components/comercial/KpiChecklistCard.tsx` (3)
- `src/pages/comercial/EdificioDetalle.tsx` (4)
- `src/pages/comercial/Edificios.tsx` (5)

## Verificación

- (1) abrir ficha edificio → aparece frase corta.
- (2) brief y OwnerDetail muestran un solo T{n}·nombre.
- (3) tarjeta KPIs muestra `Llamada dd/mm/aaaa: «cita»` en los "tenemos".
- (4) contar cuántos edificios pasan de `—` a valor (query rápida en BD).
- (5) medir tiempo de carga listado con Network tab / console.
