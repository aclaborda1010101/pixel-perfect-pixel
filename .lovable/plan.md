# PUNTO 1 — Detector de esquina por viales (determinista)

## Diagnóstico actual

`detectStreetEdges` fusiona aristas colineales (`mergeCollinearRing`) **antes** de asignar nombre de vial → un chaflán cuyo paño corto separa dos calles desaparece, y con él la prueba "2 viales distintos".

Estado verificado:
- **Cava Baja 42**: `is_corner=true` ya, pero `street_names_distinct` vacío y `corner_type` NULL → es un falso positivo por suerte (regla angular legacy). Cuando se borre la regla angular se rompería.
- **Topete 33**: `is_corner=false`, `street_names_distinct={}` → Overpass no encontró highways o el merge fundió el chaflán antes de probar nombres.

## Cambios

### 1. `supabase/functions/_shared/parcel_geometry.ts` — `detectStreetEdges`

Orden NUEVO:

```text
ring INSPIRE → asignar street_names POR ARISTA RAW
            → fusionar aristas colineales preservando UNIÓN de nombres
            → decisión de esquina sobre el ring fusionado con nombres heredados
```

Pasos concretos:

- **a)** Calcular `outsideBearing`, hacer 3 probes y recoger `street_names` para **cada arista del `ring` raw** (no del merged). Edges <1,5 m siguen ignoradas.
- **b)** Nuevo `mergeCollinearRingWithNames(ring, perEdgeNames, 10°)`: fusiona vértices colineales y **acumula la unión de nombres** de las aristas fundidas en una `Set<string>` por arista resultante. Devuelve `{mergedRing, mergedEdgeNames: Set<string>[]}`.
- **c)** Construir `street_edges[]` sobre el merged ring, asignando `street_names = Array.from(mergedEdgeNames[i])` y recomputando `is_chaflan_panel = street_names.length >= 2`.
- **d)** **Eliminar** la rama "esquina_angulo" (regla 60-120°) como condición de `is_corner`. Se mantiene `corner_angle_deg` como señal informativa.
- **e)** Decisión:
  ```text
  frentes = group street_edges by primary street_name (ignore null/empty),
            requiring edges of a same name to be non-contiguous along the ring
            (si todas son contiguas → cuenta como UN solo frente)
  is_corner = frentes.length >= 2
  corner_type =
    - "esquina_chaflan"   si algún edge tiene >=2 names (paño chaflán)
    - "multifachada"      si frentes >=2 sin paño chaflán
    - "linea"             en otro caso
  ```
- **f)** Nuevo campo en `StreetEdgesResult`:
  ```ts
  frentes: { vial: string; longitud_m: number; aristas: number[] }[]
  ```
  Se persistirá para reusar en el detector de fachada/ventanas.

### 2. Migración DB

Añadir columna a `parcel_geometry_cache`:

```sql
ALTER TABLE public.parcel_geometry_cache
  ADD COLUMN IF NOT EXISTS frentes_jsonb jsonb;
```

### 3. `recompute-corner-detection/index.ts`

- Persistir también `frentes_jsonb`.
- Para cada cambio de `is_corner`, además del `building_feedback` ya generado, **upsert en `qa_ground_truth`** la columna `es_esquina = new_is_corner` con `fuente_verificacion='corner_detector_v3'` SOLO si no existe ya `verificado_por` humano (no piso ground-truth humano).
- Añadir al response un bloque `verifications` con Cava Baja 42 + Topete 33 explícitamente (lookup por dirección).

### 4. Ejecución y aceptación

1. Deploy de `recompute-corner-detection`.
2. Forzar recompute de los 74 con `force=true` (la caché actual tiene names vacíos).
3. Llamar `recompute-corner-detection` para regenerar `is_corner/corner_type/frentes/street_names_distinct` y emitir feedbacks/qa.
4. Verificar en SQL:
   - Cava Baja 42 → `is_corner=true`, `corner_type='esquina_chaflan'`, `street_names_distinct` contiene al menos "Cava Baja" + "Plaza del Humilladero" (o vial perpendicular real).
   - Topete 33 → re-evaluado con nombres asignados pre-merge.
   - Total esquinas antes vs después.
5. Calcular precision/recall sobre `qa_ground_truth.es_esquina IS NOT NULL` (las verificadas por humanos). Si <95% → no se promociona, se devuelve la tabla con los discrepantes.

## Notas técnicas

- No se toca RLS.
- La fuente de nombres sigue siendo Overpass highways (`name` tag) dentro del radio bbox + padding 25 m. Google Roads se mantiene como fallback puntual.
- `qa_ground_truth.es_esquina` solo se rellena para los cambios; el set verificable son los edificios marcados por el equipo (los que tengan `verificado_por` no-null) — la métrica precision/recall se calcula sobre ese subconjunto.

## Archivos tocados

- `supabase/functions/_shared/parcel_geometry.ts` (refactor `detectStreetEdges` + nuevo `mergeCollinearRingWithNames`)
- `supabase/functions/recompute-corner-detection/index.ts` (persistir `frentes`, upsert qa, verificaciones explícitas)
- Migración SQL: `parcel_geometry_cache.frentes_jsonb`

No se toca producción de scoring ni de fachada en esta fase.
