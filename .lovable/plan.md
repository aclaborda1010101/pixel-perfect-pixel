## Objetivo
Mejorar la precisión del análisis IA de plantas para que cuente correctamente todos los patios y añada el conteo (o estimación) de ventanas que dan a patio, y fijar Gemini 3.5 Flash como modelo único.

## 1. Prompt del análisis (`analyze-building-vision/index.ts`)

**Patios — corregir conteo:**
- Reforzar la regla de detección: contar TODOS los recintos cerrados sin techo del PISO 01, no solo los etiquetados `P01..P0N`.
- Aceptar variantes de etiqueta: `P`, `PI`, `PT`, `PTO`, `PAT`, `P-`, sufijos numéricos (`P01`, `P02`, `PTO1`, `PTO2`…), y patios sin código (huecos interiores rodeados por viviendas).
- Pedir que liste explícitamente cada patio en `patios_codigos` (uno por entrada) y que `patios_detectados = length(patios_codigos)`.
- Añadir verificación cruzada con el plano cenital de página 1 (huecos oscuros centrales) y satélite cenital.
- Bajar confidence si hay discrepancia entre fuentes.

**Ventanas a patio — nuevo campo:**
- Añadir al JSON:
  - `ventanas_patios_total: number`
  - `ventanas_patios_por_planta: { "1": n, "2": n, ... }`
  - `ventanas_patios_por_patio: { "P01": n, "P02": n, ... }` (cuando sea identificable)
- Instrucción de conteo:
  1. Si los planos de planta muestran huecos en los muros que dan al patio → contarlos directamente por patio y multiplicar por nº de plantas tipo.
  2. Si no son visibles → **estimar** asumiendo 1 ventana por vivienda colindante al patio en cada planta tipo.
  3. Incluir en `metricas_detalle.ventanas_patios_total` el `reasoning` y marcar `source: ["catastro_pdf_piso_01", "inferred_symmetry"]` cuando sea estimación.

## 2. Modelo — Gemini 3.5 Flash siempre

En `runVisionAnalysis`:
- `primaryModel` por defecto = `google/gemini-3.5-flash` (ya hecho).
- **Eliminar el fallback** que reintenta con otro modelo cuando confidence < 0.6. Mantener solo los 3 reintentos sobre el mismo modelo (Flash 3.5).
- `model_override` sigue respetándose por si el usuario lo fuerza desde UI, pero sin fallback automático a Pro.

## 3. Persistencia y UI

**`building_analysis`** — añadir columnas (migración):
- `ventanas_patios_total integer`
- `ventanas_patios_por_planta jsonb`
- `ventanas_patios_por_patio jsonb`

**Mapeo en la edge function:** parsear los nuevos campos del JSON y guardarlos en el upsert.

**Ficha del edificio** (`/comercial/edificios/:id`):
- Mostrar junto al chip de "ventanas fachada" otro chip "ventanas patio".
- En el desglose por planta añadir una columna/fila "Ventanas patio".
- Mostrar nº de patios con detalle de códigos detectados.

## 4. Scoring (vista `v_building_score`)

No tocar pesos (recién rebalanceados a 100). Solo asegurar que `ventanas_fachada_total` sigue siendo el campo principal del score; las ventanas a patio se muestran pero no entran en el score (no aportan a "elevable/comercializable").

## Detalle técnico

```text
Edge function flow:
  POST → waitUntil(runVisionAnalysis)
    └─ build PROMPT (con nuevas reglas patios + ventanas_patios)
    └─ call Lovable AI Gateway model=gemini-3.5-flash (3 reintentos)
    └─ parse JSON estricto
    └─ upsert building_analysis con:
         ventanas_fachada_total, ventanas_por_planta,
         ventanas_patios_total, ventanas_patios_por_planta, ventanas_patios_por_patio,
         patios_detectados, patios_codigos, ...
    └─ trigger compute_score (sin cambios)
```

Tras esto, relanzar el análisis sobre el edificio actual (Cava Baja 42) para validar que detecta los 7 patios y muestra ventanas a patio.