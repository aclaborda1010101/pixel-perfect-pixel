## Plan: arreglo global tras feedback de 11 edificios

Trabajo dividido en **5 frentes** que se pueden ir cerrando en este orden. Algunos toques entran en el motor de scoring; los acoto.

---

### 1. Subdivisión Chamberí y Salamanca (motor de categorización)

Hoy `madrid_barrio_clusters` mapea un cluster por barrio entero. Voy a:

- Añadir columna `sub_zona` (texto) y `cluster_override` por calle/tramo a una nueva tabla `madrid_calles_subzona` (calle normalizada + rango de números opcional + sub-zona).
- Migración con heurística inicial:
  - **Chamberí prime**: Almagro entero, eje Castellana, Génova-Sagasta, Fortuny, Fernando el Santo → `prime_value_add` puro.
  - **Chamberí flex**: Gaztambide, Vallehermoso, Hilarión Eslava, Magallanes, Galileo, Donoso Cortés → `flex_living_core` con techo en prime_value_add si tamaño>1500 y ratio bueno.
  - **Salamanca prime**: Serrano, Velázquez, Castelló, Lagasca, Goya entre Serrano y Velázquez, Recoletos → `ultra_prime` o `prime_value_add` según tamaño.
  - **Salamanca flex (Guindalera/Fuente del Berro/Lista este)**: Porvenir, Cartagena, Francisco Silvela, Pilar de Zaragoza → `flex_living_core`.
- En `compute_cluster_score` añadir consulta opcional a `madrid_calles_subzona` ANTES de aplicar el cluster del barrio: si hay match por calle (normalizada) gana sobre el barrio.
- Recategoriza automáticamente Gaztambide 13 (→ flex), Porvenir 8 (→ flex) y deja Serrano 16 como ultra_prime.

### 2. Owners: dedup en UI + bonus proindiviso >5 (motor)

- **UI**: cambiar `BuildingDetail` / `EdificioDetalle` para mostrar `count_distinct_owners()` en vez de `building_owners.count`. Topete 33 pasará de "4" a "22".
- **Motor**: nuevo tramo de puntuación en el componente `owners` de `compute_cluster_score`:
  - 1 owner: 0
  - 2-4: peso actual
  - 5-9: +0.5 sobre el peso del cluster
  - 10+: +1.0 sobre el peso del cluster + flag `proindiviso_grande` en avisos
- Aplica a Topete 33 (22), Esparteros 13 (29), Amparo 92 (10), Manuela Malasaña, Gaztambide.

### 3. Protección histórica: cruce con catálogo PGOU Madrid

- Edge function nueva `sync-pgou-catalog-protegidos`: descarga el Catálogo de Bienes y Espacios Protegidos del Ayuntamiento de Madrid (datos abiertos: dataset "Catálogo Geográfico de Edificios Protegidos") y lo cachea en tabla nueva `madrid_edificios_protegidos` con `ref_catastral`, `nivel_proteccion`, `direccion_normalizada`.
- Nueva función `check-proteccion-pgou` por edificio: cruza `catastro_data.refcat` y, si no hay match exacto, normaliza dirección + portal y hace fuzzy.
- Si match → fuerza `building_analysis.protegido_historicamente = true` con `proteccion_source = 'pgou_catalogo'`.
- Si la VLM había dicho true y el catálogo dice false, dejamos hint pero no sobrescribimos sin revisión.
- Reproceso de la cartera (74) en lote.
- Resuelve Juan Duque 14, Gaztambide 13, Sanz Raso 18.

### 4. Conteo de ventanas: prompt v2 + remuestreo

- Reforzar el prompt VLM en `count-facade-windows` y `count-patio-windows`:
  - Definir explícitamente: ventana = hueco vidriado con marco; **no contar** como ventana de patio: respiraderos, celosías de tendedero, claraboyas, balcones cerrados ya contados en fachada.
  - Pedir conteo por planta visible y validar `total = sum(plantas)` antes de devolver.
  - Devolver `confidence` por imagen y descartar imágenes con confidence<0.4 antes de promediar.
- Relanzo los 11 edificios del feedback con `force=true` y te enseño tabla comparativa antes/después.
- Si la mejora se ve clara, segunda tanda con los 63 restantes.

### 5. Reglas de cambio de uso + render del scoring summary (bug Topete)

- En `compute_cluster_score` ya está la regla `cambio_uso_hospedaje` cuando protegido + ≥2 escaleras. Está fallando porque:
  - Amparo 92: regla aplicada pero no aparece como aviso en UI → revisar render avisos.
  - Plaza San Miguel 5: solo detecta 1 escalera (VLM mal) → al actualizar a 2 disparará.
  - Serrano 16: ya marcado ultra_prime, pero terciario_pct está mal calculado porque le falta el dato de superficies; revisar fallback al campo del catastro authority.
- **Bug Topete**: el resumen muestra "rango 500-1000 m²" cuando el edificio tiene 2369 m². Es el campo `rango_tamano` que se calcula con el cluster que tuviera **antes** del gate degradación. Hay que recalcularlo después de aplicar el gate.
- HubSpot SL Serrano 16: en `building_owners` cargamos contactos pero no empresas. Añadir join también con `building_companies` en el resumen de propiedad.

---

### Orden de entrega

1. Migración subdivisión barrios + edit motor + recategoriza ya (frente 1).
2. Migración dedup owners + bonus + fix UI (frente 2).
3. Bug render Topete + fix terciario Serrano + render avisos cambio_uso (frente 5).
4. Function sync catálogo PGOU + reproceso protección (frente 3).
5. Prompt VLM v2 + remuestreo 11 + decisión sobre los 63 (frente 4).

Cada frente termina con tabla comparativa antes/después de los 11 edificios del feedback.

### Lo que **no** voy a tocar

- Lectura del catastro (DNPRC, planos).
- Plantas levantables (Sanz Raso 18): requiere normativa por calle, lo dejamos para otra tanda.
- Texto narrativo del `score_summary` (lo regenera `enhance-building-score` al final automáticamente).

¿Lanzo el frente 1 ya o reordenamos?
