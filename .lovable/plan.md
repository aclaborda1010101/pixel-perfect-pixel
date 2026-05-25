## Diagnóstico

Dos causas independientes confirmadas en base de datos:

1. **"Mi cartera" muestra 6:** las 74 asignaciones activas están en el usuario Agustín, no en Jesús (que es quien tiene sesión). Jesús solo tiene 6 asignaciones activas reales.
2. **El plano de distribución por plantas no aparece:** la tabla `public.catastro_data` está **vacía** (0 filas). La función `fetch-catastro-data` nunca llegó a insertar nada para los edificios de la cartera demo (incluido Topete 33), así que la ficha del edificio no tiene `plantas_pdf_url` ni `plantas_pages_urls` que mostrar — no es un problema de la UI, es que no se ha ejecutado / no se ha guardado.

## Plan

1. **Reasignar las 74 asignaciones de cartera a Jesús**
   - Insertar en `building_assignments` una fila por cada uno de los 74 `building_id` actualmente activos en Agustín, con `user_id = Jesús` y `status = 'active'`, idempotente (no duplicar si ya existe).
   - No tocar las asignaciones de Agustín.

2. **Paginar también la lectura de `buildings` en `Edificios.tsx`**
   - El fetch auxiliar de `cartera_demo_seed`, `avisos_inteligentes`, `score_summary` y `confianza_media` no está paginado, así que con 7.772 edificios se trunca a 1.000 y los marcados como demo pueden quedar fuera.
   - Aplicar el mismo bucle de páginas de 1.000 que ya se usa para `v_building_score`.

3. **Corregir la persistencia en `fetch-catastro-data`**
   - Sustituir el `update(...).eq('refcatastral', refcat)` final por un `upsert` por `refcatastral` que también incluya `building_id`. Hoy, si el edificio ya tenía refcatastral y no había fila previa en `catastro_data`, el `update` no afecta filas y se pierde todo (PDF, miniaturas, dnprc).
   - Eliminar la rama previa que insertaba con `refcatastral = 'unknown-...'` cuando no se obtenía refcat: usar `building_id` como clave alternativa para no contaminar la unique de refcatastral.
   - Asegurar que en la respuesta final se guardan `plano_url`, `plantas_pdf_url`, `plantas_pages_urls`, `plantas_num_pages`, `plantas_pdf_disponible`, `fetch_quality`, `fetched_at`.

4. **Lanzar el procesamiento de los 74 desde el botón existente**
   - El botón "🚀 Lanzar procesamiento Cartera Demo Mayo (79 edificios)" ya existe en Ajustes → Análisis IA.
   - Tras el deploy del fix, lanzarlo una vez para poblar `catastro_data` y rellenar los planos de los 74.

5. **Validar de extremo a extremo con Topete 33**
   - Comprobar que `catastro_data` tiene fila con `plantas_pdf_disponible = true` y `plantas_num_pages = 7`.
   - Abrir `/comercial/edificios/<id-topete>` y ver "📄 Abrir PDF completo" + las 7 miniaturas.
   - Comprobar en `/comercial/edificios` que el contador es "Mi cartera (74)".

## Detalles técnicos

- **Causa real "6 vs 74":** mismatch de `user_id` en `building_assignments` + fetch de `buildings` sin paginación.
- **Causa real "no descarga el plano":** la función no persiste nada porque el último paso es un `UPDATE` sobre una tabla vacía. El PDF en sí (descarga desde Catastro y rasterización) está bien resuelto; el bug es de escritura en BBDD.
- **No requiere migraciones de esquema** ni claves nuevas; solo data fix, frontend pagination y un upsert.

## Resultado esperado

- "Mi cartera (74)" visible para Jesús.
- Para cada edificio procesado: PDF descargable + miniaturas de cada planta en la card "🔍 Análisis del plano catastral".
- Topete 33 con sus 7 páginas visibles como caso de validación.