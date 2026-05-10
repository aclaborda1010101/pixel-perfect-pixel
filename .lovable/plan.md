## Objetivo

Arreglar las métricas engañosas en `/productividad` y dar control sobre la ventana temporal del Coach IA.

## A. Frontend `/productividad` — métricas honestas

En `src/pages/Productividad.tsx`:

1. **Duración media** (KPI + tabla comparativa): excluir `outcome = 'no_contestado'` y `duracion_seg = 0`. Si la muestra resultante es <5, mostrar `—` en vez de un número engañoso.
2. **Mostrar tamaño de muestra** junto a la duración: `94s · n=160`.
3. **Tabla comparativa**: subir umbral a `calls >= 10` y añadir columna "Última actividad" (días desde la última call). Ordenar por conversión, manteniendo activos arriba.
4. **Card de comercial inactivo**: badge `Inactivo · última call hace Xd` cuando última call > 14 días.

## B. Backend backfill duración (one-shot)

Migration idempotente que rellena `calls.duracion_seg = 0` para las 1611 calls que tienen match en `hubspot_calls` con `hs_call_duration = 0`. Distingue claramente "no contestada" (0s) de "sin sincronizar" (NULL). No inventa datos — solo copia los 0s reales que ya existen en HubSpot.

```sql
UPDATE calls c
SET duracion_seg = 0
FROM hubspot_calls hc
WHERE c.duracion_seg IS NULL
  AND hc.hs_id = substring(c.resumen FROM 'hs:(\d+)')
  AND hc.hs_call_duration = 0;
```

También actualizar `promote_calls/index.ts` para que en futuras promociones rellene `duracion_seg = 0` cuando HubSpot devuelve 0 (en vez de dejarlo NULL).

## C. Coach IA — ventana temporal seleccionable

### Backend `generate_coach_report/index.ts`

- Aceptar parámetros opcionales `from` (fecha) y `to` (fecha) en el body. Si no se pasan, default = últimos 30 días.
- Filtrar calls del comercial dentro del rango.
- **Skip comerciales con <10 calls en el rango**: registrar como "inactivo, sin reporte" y no llamar al LLM.
- Borrar reportes previos del mismo `(comercial_hs_id, week_start)` antes de upsert para idempotencia.
- Persistir `week_start = from` y `week_end = to` para que la UI muestre la ventana real.

### Frontend tab "Coach IA"

- Añadir dos shadcn `DatePicker` (rango from/to) + botón "Generar reportes".
- Quick-picks: "Últimos 7 días", "Últimos 30 días", "Últimos 90 días".
- Cada tarjeta muestra arriba: `Periodo: 2026-04-10 → 2026-05-10 · 63 llamadas`.
- Comerciales inactivos en el rango: tarjeta gris con badge "Sin actividad en este periodo · histórico: N calls".

## D. Detalles técnicos

```text
Productividad.tsx
├─ kpis: filtrar no_contestado y dur=0 antes de avg
├─ tablaComerciales: misma lógica + columna ultima_call_dias
└─ Coach IA tab:
   ├─ DateRangePicker (shadcn)
   ├─ QuickRanges chips
   └─ generateCoachAll({from, to})

generate_coach_report/index.ts
├─ body schema: { from?: string, to?: string, chain?: bool }
├─ default range: now-30d → now
├─ por cada comercial activo:
│   ├─ if calls_in_range < 10 → skip (registro inactivo)
│   └─ else → LLM + upsert con week_start=from, week_end=to
```

## Reglas

- HubSpot read-only, sin nuevas escrituras.
- Migration idempotente (solo actualiza filas con NULL).
- Sin tocar la lógica de mapeo comercial ya validada.
- Sin avanzar a E.1 hasta tu confirmación final tras revisar el resultado.

## Reporte final que entregaré

1. Migración aplicada: X calls actualizadas con `duracion_seg = 0`.
2. KPI duración antes/después por comercial (esperado: subida significativa al filtrar 0s y no_contestado).
3. Reportes coach regenerados con ventana = últimos 30 días por defecto, mostrando `n` calls real por comercial.
4. Captura de la nueva UI con date range picker funcional.