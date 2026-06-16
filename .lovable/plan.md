## Problema confirmado (números reales)

- 12 de 56 edificios con `building_owners.cuota` rellena suman **>100 %** (varios al **400 %**, uno a **25.200 %** en P.º Martínez Campos 23).
- Patrón claro: `sum_cuotas ≈ 100 × nº notas_simples`. Causa raíz: `link_notas_simples` escribe `cuota = porcentaje` del titular en `building_owners` **una vez por cada nota_simple** (cada finca registral), tratando un % "de mi piso" como si fuera "% del edificio".
- La detección de **división horizontal** está rota: solo 1 edificio en toda la base tiene `division_horizontal = true`, cuando muchos tienen 4-36 notas distintas (claramente DH).

## Modelo correcto

| Caso | Verdad de ownership | Donde vive |
|---|---|---|
| **Sin DH** (1 finca registral) | cuota = % del edificio. Σ owners = 100 %. | `building_owners.cuota` |
| **Con DH** (N viviendas / fincas) | cuota es % **de una finca concreta**, no del edificio. | `nota_simple_titulares.porcentaje` (ya vinculado a `nota_simple_id`, una nota = una finca) |

`building_owners.cuota` en edificios DH no debe usarse como % del edificio — o se deja NULL, o se calcula como ponderación por superficie/valor de finca (futuro).

## Alcance del fix (troceado, bajo demanda, autónomo)

### Bloque 1 — Detección de DH (corregir flag)
- Función `detect_division_horizontal` (edge, manual + parametrizable): marca `buildings.division_horizontal = true` cuando se cumpla **al menos uno**:
  - ≥ 2 `notas_simples` con distinto `structured_json.finca_registral` o distinta `refcatastral` de finca,
  - o catastro indica >1 subparcela/unidad constructiva con uso residencial,
  - o `numero_propietarios` provisto por usuario > nº fincas detectables = 1 (heurística débil, solo log).
- Solo escribe si hay evidencia ≥ moderada; en duda → deja `false` y añade `metadatos.dh_needs_review = true`.

### Bloque 2 — Recalcular `building_owners.cuota`
- Función `recompute_building_owner_cuotas` (edge, idempotente, por building o batch):
  - **Si DH=true** → `cuota = NULL` para todas las filas del building y `metadatos.cuota_source = 'dh_por_finca'`. La verdad queda en `nota_simple_titulares`.
  - **Si DH=false** → re-derivar desde `nota_simple_titulares` agrupando por owner: tomar el `porcentaje` (debería ser igual en todas las notas si solo hay 1 finca; si hay varias, promediar o coger la nota más reciente y avisar).
  - Marcar `metadatos.cuota_inconsistente = true` si Σ owners ≠ 100 ± 1 % en edificios sin DH.

### Bloque 3 — Parar la sangría en `link_notas_simples`
- Antes de escribir `cuota` en `building_owners`, mirar `buildings.division_horizontal`:
  - DH=true → no escribir `cuota` (queda NULL); seguir manteniendo `nota_simple_titulares`.
  - DH=false → escribir solo si no existe ya; si existe y difiere, no sobre-escribir, registrar en `metadatos.cuota_pending_review`.

### Bloque 4 — UI
- **`BuildingDetail.tsx`**:
  - Si `division_horizontal === true`:
    - Sustituir KPI "Cuota total" por **"Viviendas / fincas"** (= nº de notas distintas).
    - Nueva sección "**Propiedad por vivienda**": agrupada por nota_simple (ubicación/finca registral), lista de titulares con su % y rol. No mostrar `cuota` del edificio.
    - Badge "División horizontal" ya existe — mantener.
  - Si `division_horizontal === false`:
    - Mantener KPI "Cuota total" pero con aviso visual cuando Σ > 100,5 % ("Cuotas inconsistentes — revisar notas").
- **`OwnerDetail.tsx`**: en la lista de edificios del owner, si el edificio es DH mostrar `"% sobre vivienda X"` o `"varias fincas"` en lugar del `cuota` plano. Si no es DH, comportamiento actual.
- **`AssetDetail.tsx`**: ya muestra owners con cuota; añadir cabecera "% sobre esta vivienda" cuando el edificio sea DH.
- Ningún cambio en `detect_influencers` en este bloque (ya usa cuota cap-ada al 0,4 y bonos; con cuotas NULL en DH simplemente puntúa por rol/calls — aceptable de momento; nota para futuro: ponderar por superficie de finca).

### Bloque 5 — Validación con datos reales
- Ejecutar Bloque 1 + Bloque 2 sobre toda la base, dimensionar:
  - cuántos edificios pasan a DH=true,
  - cuántos quedan con `cuota_inconsistente`,
  - confirmar que P.º Martínez Campos 23 (sum=25.200 %) y Zurbano 57 (400 %) ya no muestran cifras absurdas.
- Validar 3 casos: 1 edificio DH con muchas notas, 1 sin DH con cuota correcta, 1 sin DH con cuota inconsistente.

## Lo que NO se toca
- `nota_simple_titulares` (ya tiene el dato correcto por finca).
- `assets` (no hay assets sembrados para los edificios afectados; el modelo de "vivienda" hoy es la `nota_simple`).
- Cálculo de score/cluster del edificio.
- `agent_voss_coach` / timeline (intactos).

## Detalles técnicos
- Nuevas funciones edge: `detect_division_horizontal`, `recompute_building_owner_cuotas` (ambas aceptan `{ building_id? , dry_run?, max_buildings? }`, devuelven `{ processed, changed, sample }`).
- Edit en `supabase/functions/link_notas_simples/index.ts`: gate del `INSERT` en `building_owners` por `division_horizontal`.
- Migración: añadir columnas `metadatos.cuota_source`, `metadatos.cuota_inconsistente` (van dentro del `metadatos jsonb` existente, sin DDL nueva). Si quieres trazabilidad estricta, añadir `building_owners.cuota_inconsistente boolean` — opcional.
- Botones en Settings (Jobs manuales) para disparar Bloque 1, Bloque 2 y un "fix completo" encadenado.

¿Lo ejecuto entero o prefieres empezar por el Bloque 1+2 (corrige datos sin tocar UI) y validar números antes de los bloques 3-4?