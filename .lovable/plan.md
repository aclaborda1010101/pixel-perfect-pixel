## Objetivo

Sustituir el scoring actual (fórmula única en `v_building_score`) por el **modelo de 5 clusters** del PDF, aplicarlo a los **74 edificios** y reflejarlo en la ficha y el listado.

## 1. Tabla de clusters por barrio (nueva)

Nueva tabla `madrid_barrio_clusters`:
- `distrito text`, `barrio text` (PK compuesto, normalizado en mayúsculas sin acentos)
- `cluster text` enum: `ultra_prime`, `prime_value_add`, `flex_living_core`, `outer_distressed`, `outer_distressed_selectivo`, `baja_prioridad`
- Se semilla desde el PDF (sección 3, ~todos los barrios de Madrid).

Tabla `madrid_calles_comerciales` (cluster 5 transversal):
- `calle text` PK normalizada (Bravo Murillo, General Ricardos, Alcalá, Ibiza, Narváez, etc.)
- `tipo text`: `buena` (renta comercial) | `mala` (cambio de uso)

## 2. Señales nuevas en `building_analysis` (IA)

Añadir columnas para que la IA de visión + lectura de CRM pueble:
- `mala_gestion_score smallint` (0-10) ← derramas, ITE, impagos, contratos caóticos, propietarios cansados
- `local_pb_m2 numeric`, `local_pb_fachada_m numeric`, `local_pb_esquina bool`, `local_pb_viviendas_potenciales smallint`
- `edificio_reformado bool`, `gestion_profesional bool` (penalizaciones)
- `cluster_asignado text`, `cluster_score numeric`, `cluster_breakdown jsonb`

## 3. Función `compute_cluster_score(building_id)` (PL/pgSQL)

Reemplaza `compute_score`. Pasos:
1. Lee `buildings + building_analysis + metadatos`.
2. Resuelve `barrio → cluster` vía `madrid_barrio_clusters` (fallback `baja_prioridad`).
3. Aplica la **tabla de pesos del cluster** (Ultra Prime, Prime Value-Add, Flex Living Core, Outer Distressed) usando los rangos del PDF (m², ratio m²/vivienda, nº viviendas, nº propietarios, mala gestión).
4. Si la dirección hace match con `madrid_calles_comerciales` o el local PB cumple criterios → suma cluster 5.
5. Resta penalizaciones (reformado -25, gestión profesional -15, sin conflicto -10, etc.).
6. Guarda `score`, `cluster_asignado`, `cluster_breakdown` en `buildings`.

Vista `v_building_score` se reescribe encima de esta lógica para mantener compatibilidad con el frontend.

## 4. IA de lectura de CRM/notas (`enhance-building-score`)

Extender el prompt para que, además de visión, devuelva en JSON:
- `mala_gestion_score`, evidencias citadas
- `edificio_reformado`, `gestion_profesional`
- `local_pb_*` cuando aparezca en plano FXCC o foto fachada

Llamado vía Lovable AI Gateway (`google/gemini-2.5-pro`) con contexto: notas comerciales, llamadas analizadas, FXCC, fachada Google.

## 5. Reproceso de los 74 edificios

Nueva edge function `recompute-cluster-scoring` (batch):
- Itera los 74 edificios
- Reanaliza con `enhance-building-score` (lectura CRM + visión) si `cluster_breakdown` está vacío o desactualizado
- Llama `compute_cluster_score(id)` para cada uno
- Devuelve resumen por cluster

Se dispara desde un botón "Recalcular scoring (clusters)" en `/comercial/edificios`.

## 6. UI

- **Listado `Edificios.tsx`**: añadir chip `cluster_asignado` y filtro por cluster.
- **Ficha `EdificioDetalle.tsx`** + `scoring.tsx`: mostrar cluster, pesos del cluster aplicado, breakdown nuevo, penalizaciones, señales CRM detectadas.
- Tooltip que explique por qué este edificio cayó en este cluster.

## Detalles técnicos

```text
flow:
 buildings.barrio  ──► madrid_barrio_clusters ──► cluster
 building_analysis ──► variables IA + CRM
              ▼
 compute_cluster_score(id)
   ├── pesos cluster (tabla del PDF)
   ├── bonus cluster 5 (calle/local)
   └── penalizaciones
              ▼
 buildings.score / cluster_asignado / cluster_breakdown
              ▼
 UI: chip + breakdown
```

Migraciones nuevas (no se tocan las antiguas):
- `add_cluster_tables.sql` (2 tablas + seed)
- `add_cluster_columns_building_analysis.sql`
- `compute_cluster_score.sql` (reemplaza función) + `v_building_score` v2

## Confirmación necesaria

¿Procedo tal cual, o quieres ajustar algo antes (por ejemplo, conservar el scoring viejo en paralelo como `score_legacy`, o cambiar algún peso del PDF)?