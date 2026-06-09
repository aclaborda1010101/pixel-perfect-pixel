## BLOQUE F1-A — Fixes scoring + UI

Cinco cambios atómicos. No tocamos RLS. No tocamos VLM/ventanas. Sólo lo listado.

---

### 1. Conteo único de propietarios (§2.5)

**Migración SQL:**
- `count_distinct_owners(uuid)` ya existe — la dejo tal cual.
- Añadir índice único parcial:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_building_owner_normalized
    ON public.building_owners (building_id, (public.normalize_person_name(
      (SELECT o.nombre FROM public.owners o WHERE o.id = owner_id)
    )));
  ```
  Como el normalize requiere subselect, en realidad lo implementaremos como **constraint vía trigger BEFORE INSERT** que haga lookup y RAISE unique_violation, porque los índices funcionales no pueden hacer subselects. Alternativa más simple: dedupe previa + UNIQUE `(building_id, owner_id)` ya existe → reforzamos con dedupe por `normalize_person_name` en el sync.

**Edge function `hubspot_sync_associations`:**
- Antes del upsert de `rows`, agrupar por `(building_id, normalize_person_name(owner.nombre))` y descartar duplicados consultando `owners.nombre` previamente cargado.
- Mantener `onConflict: 'building_id,owner_id', ignoreDuplicates: true`.

**Frontend — nuevo hook `src/hooks/useOwnersCount.ts`:**
```ts
export function useOwnersCount(buildingId?: string) {
  return useQuery({
    queryKey: ['owners-count', buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('count_distinct_owners', { p_building_id: buildingId });
      if (error) throw error;
      return Number(data ?? 0);
    },
  });
}
```

**Sustituciones:**
- `BuildingDetail.tsx` línea 80 area + render `Propietarios · {owners.length}` (línea 279) → usar `useOwnersCount` para el contador (la lista sigue siendo `owners`, pero el badge usa el count distinto).
- `EdificioDetalle.tsx` línea 196 (`s.owners_count`) → usar `useOwnersCount`.
- `Buildings.tsx` líneas 83 y 97 (count `building_owners` por edificio) → ya muestra duplicados; reemplazar por RPC batch nueva `count_distinct_owners_batch(uuid[])` (la añado en la misma migración, retorna `setof (building_id uuid, n int)`).

---

### 2. `compute_cluster_score`: gates antes de pesos (§2.6)

Reescritura de la función (mantengo firma y output):

Orden actual: cálculo `v_m2/v_viv/v_owners` → degradación cluster → cálculo `rango_tamano`, pesos, `s_*`, breakdown.

Orden nuevo:
1. Cargar `b`, `ba`, lookups barrio/calle → `v_cluster` inicial.
2. Cargar métricas crudas (`v_m2`, `v_viv`, `v_owners`, `v_terciario_pct`, `v_n_escaleras`, `v_protegido`).
3. **Bloque de gates** (todos antes de cualquier peso):
   - Degradación ultra_prime → prime_value_add si `m2 < 1000`.
   - Upgrade a ultra_prime si protegido + ≥2 escaleras + terciario ≥66%.
   - Avisos `cambio_uso_hospedaje` se emiten aquí.
4. **Después** del cluster definitivo: calcular `rango_tamano`, `rango_ratio`, asignar pesos `w_*` según cluster, calcular `s_*`, breakdown y score final.

Esto arregla Topete 33 (2369 m², degradado de ultra_prime → prime_value_add: hoy mantiene el rango ultra_prime; con el fix tomará el rango de prime_value_add) y Esparteros 13.

---

### 3. Cambio de uso a hospedaje (§2.3)

**3a. `v_terciario_pct` con COALESCE en `compute_cluster_score`:**
```sql
v_terciario_m2 := COALESCE(
  -- Vía 1: catastro_authority_cache.usos_detalle (jsonb por planta)
  (SELECT SUM((u->>'superficie')::numeric)
     FROM public.catastro_authority_cache cac,
          jsonb_array_elements(cac.usos_detalle) u
    WHERE cac.building_id = p_building_id
      AND lower(u->>'uso') ~ '(oficina|comercio|hostel|industrial|terciario)'),
  -- Vía 2: metadatos HubSpot (legacy)
  (COALESCE(NULLIF(md->>'metros_cuadrado_oficina','')::numeric,0)
   + COALESCE(NULLIF(md->>'metros_cuadrados_comercio','')::numeric,0)
   + COALESCE(NULLIF(md->>'metros_cuadrados_ocio_hostel','')::numeric,0)
   + COALESCE(NULLIF(md->>'metros_cuadrados_industrial','')::numeric,0)),
  0
);
-- Vía 3 (booleana): si ba.uso_predominante_planta_baja IN ('comercial','terciario') y aún 0%,
--   marcar v_terciario_pct := GREATEST(v_terciario_pct, 0.34) para que dispare el aviso si hay escaleras+protección.
```

**3b. `n_escaleras` reforzado:**
```sql
v_n_escaleras := GREATEST(
  COALESCE(ba.n_escaleras_en_piso01, 0),
  COALESCE((SELECT count(DISTINCT subparcela) FROM public.catastro_authority_cache cac,
            jsonb_array_elements(cac.subparcelas) sp
            WHERE cac.building_id = p_building_id), 0)
);
```
(verificaré el nombre real de la columna; si la lista de subparcelas vive en otra columna, ajusto en build mode).

**3c. Avisos inteligentes en UI:**
- En `ScoringResumen.tsx` ya hay `highAvisos` renderizándose como Badges en la cabecera (líneas 372-384). Añadir, debajo de la narrativa, un nuevo bloque `<AvisosInteligentes>` con Card destacada (icon `AlertTriangle`) listando avisos `high` y `medium` con `label` + `detail`.

---

### 4. Curva proindiviso (§2.4)

Dentro del nuevo bloque de pesos en `compute_cluster_score`, sustituir el cálculo de `s_own` por:
```sql
IF v_owners <= 1 THEN s_own := 0;
ELSIF v_owners <= 4 THEN s_own := 0.4;
ELSIF v_owners <= 9 THEN s_own := 0.8;
  v_avisos := v_avisos || jsonb_build_object('key','proindiviso_grande','label','Proindiviso grande','severity','medium','detail', v_owners||' propietarios');
ELSIF v_owners <= 19 THEN s_own := 1.0;
  v_avisos := v_avisos || jsonb_build_object('key','proindiviso_grande',...);
ELSE s_own := 1.0; v_bonus := v_bonus + 5;
  v_avisos := v_avisos || jsonb_build_object('key','proindiviso_critico','severity','high', ...);
END IF;
```
Cluster weights:
- `flex_living_core.w_own = 25` (subir desde el valor actual).
- `prime_value_add.w_own = 25` (idem).

Renormalizar los pesos del cluster para que sigan sumando 100.

---

### 5. Unificar trigger (§4.1)

```sql
CREATE OR REPLACE FUNCTION public.trg_recompute_score() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.compute_cluster_score(NEW.building_id);
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.compute_score(uuid) IS
  'DEPRECATED 2026-06: use compute_cluster_score. Kept for v_building_score back-compat.';
```

No borro `compute_score` (lo usan vistas). Sólo marca + redirección del trigger.

---

### Validación

Tras aplicar la migración, en la misma sesión de build mode:
```sql
SELECT b.direccion, b.score AS antes; -- snapshot
SELECT public.compute_cluster_score(id) FROM buildings
  WHERE direccion ILIKE ANY (ARRAY['%Topete%33%','%Serrano%16%','%Amparo%92%','%Plaza San Miguel%5%','%Gaztambide%13%','%Manuela Malasaña%11%']);
SELECT direccion, score, cluster_asignado, avisos_inteligentes FROM buildings WHERE ...; -- después
```
Devuelvo tabla markdown antes/después con: score, cluster, rango_tamano, s_own, avisos clave.

### Riesgos / mitigación

- **Renormalizar pesos** puede mover scores agregados en el resto de la cartera. Sólo recomputo los 6 edificios; el resto se recalculará cuando el trigger se dispare normalmente.
- **Trigger redirect**: si `compute_cluster_score` falla en un edificio sin cluster mapeado, devuelve `baja_prioridad` y no rompe el insert (ya tiene NOT FOUND guard).
- **Índice único normalizado**: implementado vía dedupe en el sync, no como UNIQUE INDEX (limitación funcional Postgres). Documentado en el código.

### Archivos a modificar

1. Migración SQL (un solo archivo): `compute_cluster_score` reescrita + `trg_recompute_score` redirigido + COMMENT en `compute_score` + `count_distinct_owners_batch`.
2. `supabase/functions/hubspot_sync_associations/index.ts` — dedupe por nombre normalizado.
3. `src/hooks/useOwnersCount.ts` — nuevo.
4. `src/pages/BuildingDetail.tsx` — usar hook para el badge.
5. `src/pages/comercial/EdificioDetalle.tsx` — usar hook.
6. `src/pages/Buildings.tsx` — usar RPC batch.
7. `src/components/comercial/ScoringResumen.tsx` — bloque avisos inteligentes ampliado.
