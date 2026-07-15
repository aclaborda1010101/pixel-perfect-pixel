## Cambios en `src/pages/comercial/Edificios.tsx`

### 1) Limpiar la barra de acciones
Quitar del `PageHeader.actions` los 4 botones:
- "Dar de alta nuevo edificio"
- "Recalcular clusters (74)"
- "Procesar pendientes (n)"
- "Reprocesar todos los n"

Con eso además retiro el código muerto que arrastran:
- `launchBatch`, `launchClusterRecompute`, estado `batchBusy` y `showNewBuilding`.
- El montaje de `<NewBuildingDialog />`.
- Imports huérfanos: `NewBuildingDialog`, `Plus`, `Sparkles`, `Loader2`, `toast`.

El `PageHeader` queda sin `actions` (solo eyebrow/title/subtítulo).

### 2) Acelerar el tab "Todos los edificios"

Diagnóstico de por qué tarda "unos segundos largos":

- **Query pesada A**: paginación completa de `v_building_score` (2 páginas × 1000 filas = ~1156 rows con todas las columnas de la vista).
- **Query pesada B**: `select ... from buildings where id in (<1156 ids>)` — trae `avisos_inteligentes`, `score_breakdown`, `iee_estado`… para *todo* el catálogo aunque en la tarjeta del catálogo apenas se usan.
- **Render pesado**: se pintan 1156 `<BuildingCard>` de golpe (cada una con `Tooltip`, chips, barras, etc.). Aunque los datos lleguen, el navegador tarda en montar el DOM.

Fixes (todos frontend, sin tocar BD ni scoring):

**a) Adelgazar la query B para el catálogo.** Para la tab "Todos" solo necesito de `buildings`: `id, cluster_asignado, cluster_score, score, es_estrella, cartera_demo_seed, iee_estado, avisos_inteligentes, score_summary`. Quito `score_breakdown`, `confianza_media`, `cluster_motivo` del fetch masivo (`score_breakdown` es JSON pesado y solo se usa para las 3 barras que se pueden calcular a partir de campos ya presentes en la vista, o simplemente omitirlas en el tab "Todos"). Eso reduce mucho payload.

**b) Paginación de render (windowing simple).** Para el tab "Todos" muestro los primeros **60** resultados y añado un botón **"Cargar más (60)"** al final de la lista (o un IntersectionObserver que hace lo mismo al hacer scroll). El filtrado/sort sigue operando sobre el conjunto completo en memoria; solo `filteredTodos.slice(0, shown)` va al DOM. Esto es lo que quita los "segundos largos" reales al pinchar la pestaña — el fetch de red suele estar bajo 1 s; el resto es render.

**c) `staleTime` + `keepPreviousData`.** Subir `staleTime` a 10 min y añadir `placeholderData: keepPreviousData` para que al alternar tabs no se descarte lo ya cargado. Además prefetch on-hover del tab "Todos" (`onMouseEnter` sobre `TabsTrigger` dispara `queryClient.prefetchQuery`) para que el primer clic tenga los datos ya calientes.

**d) Micro-optimización del map.** El `.map` sobre ~1156 filas construye un objeto grande con `raw: { ...b, ... }` copiando toda la fila. Para "Todos" hago un `raw` más pequeño (solo los campos que `BuildingCard`/`AlarmChips`/`DocAlertBadge`/`buildingScoreFactors` leen realmente): `avisos_inteligentes`, `metadatos`, `catastro_ref`/`refcatastral`, `iee_estado`, `score`, `score_breakdown` (si se mantiene) o los campos numéricos ya expandidos. Menos alocación → mount más rápido.

### Confirmaciones que daré al terminar
- Los 4 botones ya no están en la cabecera.
- Al pinchar "Todos los edificios" ves las primeras ~60 tarjetas casi al instante, con contador total correcto (1.156) y botón "Cargar más".
- El número total y el filtrado siguen funcionando sobre el catálogo completo.

### Fuera de alcance
- No se toca la BD, ni scoring, ni edge functions, ni `NewBuildingDialog` (el archivo se mantiene por si se usa en otras pantallas; solo se desmonta de aquí).
