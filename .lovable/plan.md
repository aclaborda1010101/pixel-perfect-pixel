## Objetivo

1. Descargar el PDF de distribución por plantas en los 4 edificios con `refcatastral` de 14 caracteres (parcela) en lugar de 20 (bien inmueble).
2. Asegurar que el plano se muestra en la ficha del edificio (`/comercial/edificios/:id`).
3. Re-lanzar el análisis IA de scoring v2 sobre los 74 edificios para que todos tengan análisis actualizado con el plano correcto.

## Cambios

### 1. `supabase/functions/fetch-catastro-data/index.ts`

Añadir helper `expandRefcat14to20(refcat14)` que consulta `Consulta_DNPRC` con el refcat de 14 chars y reconstruye los 20 chars (`pc1+pc2+car+cc1+cc2`) del primer bien inmueble.

Antes de `PLANTAS_PDF_CANDIDATES(refcat)`, si `refcat.length === 14`, llamar al helper y usar el refcat de 20 chars para descargar el PDF y nombrar los archivos en storage (`{refcat20}_plantas.pdf`, `{refcat20}_p{N}.png`). Persistir el refcat completo en `buildings.refcatastral` y en `catastro_data.refcatastral` (vía upsert).

### 2. Ficha del edificio — verificar render del plano

`src/components/comercial/AnalisisPlanoCatastralCard.tsx` ya muestra `plantas_pages_urls` y el botón "Abrir PDF completo". Revisar `src/pages/comercial/EdificioDetalle.tsx` para confirmar que este card se monta SIEMPRE (no condicionado a tener análisis IA) cuando hay `catastro.plantas_pages_urls`. Si está oculto detrás de la guarda `if (!a) return …sin análisis`, separar en dos bloques: uno que muestra siempre las páginas del PDF (aunque no haya análisis IA), y otro que añade las anotaciones cuando hay análisis.

### 3. Deploy + relanzar

- Deploy `fetch-catastro-data`.
- Lanzar `auto-process-cartera-demo` con flag para los 4 edificios con refcat de 14 chars (`force:true` en fase catastro) → descargará PDF de plantas.
- Lanzar `batch-pipeline-scoring-v2` (o el orquestador equivalente) para los 74 edificios → re-ejecuta `analyze-building-vision` con los planos catastrales ya correctos, recalcula score.

### 4. Fuera de alcance

- SVG croquis (`GeneraGraficoParcela` vacío) — pendiente.
- Cambios al pipeline de Street View / Google imagery (ya funciona).

## Detalles técnicos

**Endpoint Catastro DNPRC** (para expandir refcat):
```
https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC={refcat14}
```
Respuesta XML contiene `<rc><pc1/><pc2/><car/><cc1/><cc2/></rc>` por bien inmueble. Tomar el primero (o filtrar por uso vivienda si hay varios).

**Edificios afectados (refcat 14 chars)**:
- 2352407VK4725C, 2158511VK4725G, 1749406VK4714H, 2158510VK4725G

**Re-análisis IA**: invocar `batch-pipeline-scoring-v2` con todos los `building_id` de la cartera demo, `force:true` en fase `analyze-building-vision`. Esto regenerará `building_analysis` para los 74 con el plano correcto cuando esté disponible.
