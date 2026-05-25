# Plan: ventanas a patio auditable + validación humana

## 1. Migración DB
Nueva migración en `supabase/migrations/` para:
- `building_analysis`: añadir
  - `densidad_ventanas_fachada numeric` (ventanas/m de fachada exterior)
  - `fachada_lineal_total_m numeric` (estimación o dato Catastro)
  - `ventanas_patios_estimadas integer` (resultado fórmula)
  - `ventanas_patios_desglose jsonb` (array `{codigo, area_m2, perimetro_estimado_m, ventanas_estimadas}`)
  - `formula_ventanas_patio text` (texto auditable)
  - `confidence_ventanas numeric` + `aviso_ventanas text` (rango 4-10 vent/vivienda)
- Tabla `scoring_v2_feedback` (si no existe) con `building_id`, `user_id`, `tipo` (`ventanas_patio` | otros), `valor` (`ok` | `ajuste`), `comentario text`, `payload jsonb`, `created_at`. RLS: usuarios autenticados insertan/leen propios; admin todo.

## 2. Edge function `analyze-building-vision`
- Pedir al LLM también: por cada patio → `area_m2` aproximada (de plano catastral PISO 01) y `fachada_lineal_total_m` (perímetro del edificio que da a calle).
- Tras parseo, calcular **localmente** (no en el LLM):
  ```
  densidad = ventanas_fachada_total / fachada_lineal_total_m
  por cada patio p:
    perimetro_p = 4 * sqrt(area_p)
    ventanas_p = round(perimetro_p * densidad * plantas_visibles)
  ventanas_patios_estimadas = sum(ventanas_p)
  formula = "7 patios × densidad X vent/m × 8 plantas = Y ventanas"
  ```
- Cross-validation: `ratio = (ventanas_fachada + ventanas_patios_estimadas) / viviendas_totales`. Si fuera de [4, 10] → `confidence_ventanas = 0.4`, `aviso_ventanas` con texto explicativo.
- Persistir los nuevos campos. Sigue usando `google/gemini-3.5-flash`.

## 3. Edge function `fetch-google-imagery`
Añadir 2 capturas oblicuas extra: `heading=45` y `heading=225` con `maptype=hybrid` zoom 19 (la API Static Maps no soporta tilt real; usamos hybrid con esos rumbos para variar la vista). Persistirlas como source `oblique` con `heading`.

## 4. UI — `AnalisisIASection.tsx`
- Chip "Ventanas patios" con `Popover` mostrando `formula_ventanas_patio` + confianza + aviso.
- Card "🔍 Análisis del plano catastral" (`AnalisisPlanoCatastralCard.tsx`): nuevo bloque
  - "Plano detectó N patios [P01: 23m², …]"
  - "Ratio fachada: X vent/m · Fórmula: …"
  - Botones **Sí, correcto** / **No, ajustar** → insert en `scoring_v2_feedback`.

## 5. Reprocesar Cava Baja 42
Tras desplegar, invocar `process-building-full` (o `analyze-building-vision` + `fetch-google-imagery`) para el `building_id` 0485d8cf-c1a2-4412-b38f-e37fb18961a2 y validar 7 patios + ~40-60 ventanas patio.

## Archivos a tocar
- `supabase/migrations/<timestamp>_ventanas_patio_formula.sql` (nuevo)
- `supabase/functions/analyze-building-vision/index.ts`
- `supabase/functions/fetch-google-imagery/index.ts`
- `src/components/comercial/AnalisisIASection.tsx`
- `src/components/comercial/AnalisisPlanoCatastralCard.tsx`

## Notas técnicas
- La fórmula vive en TS (determinista), el LLM solo aporta `area_m2` por patio y `fachada_lineal_total_m`.
- `scoring_v2_feedback` con RLS por usuario; sin trigger de score (solo telemetría).
- No tocamos `v_building_score` — las ventanas a patio siguen siendo informativas.
