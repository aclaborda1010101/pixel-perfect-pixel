## Objetivo
Integrar el **estado IEE/ITE** de cada edificio como dato estructurado, visible en la ficha y con impacto en el scoring.

## Modelo de datos (nueva migración)
Añadir a `buildings` (no a `building_analysis` para que `compute_cluster_score` lo lea fácil):

| Columna | Tipo | Significado |
|---|---|---|
| `iee_estado` | enum `iee_estado` (`favorable`, `desfavorable_leve`, `desfavorable_grave`, `no_procede`, `pendiente`, `caducada`, `desconocido`) | Resultado vigente |
| `iee_fecha_inspeccion` | date | Fecha del último IEE presentado |
| `iee_proxima_revision` | date | Para favorables = fecha+10 años. Calculada en trigger. |
| `iee_anos_desde_desfavorable` | generated, integer | Solo si estado desfavorable_*: `now() - iee_fecha_inspeccion` en años. |
| `iee_deficiencias` | jsonb | Lista corta `[{categoria, gravedad, descripcion}]` (opcional) |
| `iee_fuente` | text | `'sede_madrid'` / `'manual'` / `'ia_extracted'` |
| `iee_actualizado_at` | timestamptz | |

Default `iee_estado = 'desconocido'` para no marcar 4000 edificios como huecos.

## Fuente del dato (scraper)
Nueva edge function `fetch_iee_madrid`:
- Input: `building_id` o `referencia_catastral`.
- Llama vía **Firecrawl scrape** a la consulta pública del Registro de IEE del Ayuntamiento de Madrid (`https://sede.madrid.es/...`, formulario por refcat). Si Firecrawl no está conectado, se lo pediré al usuario antes de implementar.
- Parsea con LLM (Lovable AI Gateway, `google/gemini-2.5-flash`) → JSON normalizado `{estado, fecha_inspeccion, deficiencias[]}`.
- Idempotente: cache 90 días vía `iee_actualizado_at`.
- Manejo del caso "no aparece en registro" → marca `pendiente` si el edificio tiene ≥30 años (obligado), `no_procede` si <30.

Trigger SQL: al `update` de `iee_fecha_inspeccion`/`iee_estado`, recalcular:
- `iee_proxima_revision = iee_fecha_inspeccion + interval '10 years'` si favorable.
- Si `now() > iee_proxima_revision` → estado `caducada` automático.

## Integración en scoring
Modificar `public.compute_cluster_score` para añadir un componente `s_iee / w_iee`:

| Estado | Aporte al `mala_gestion` o penalización |
|---|---|
| `favorable` y revisión > 3 años vista | bonus −1 punto mala_gestión |
| `favorable` próxima a caducar (<1 año) | neutro |
| `caducada` | +2 mala_gestión |
| `pendiente` (obligada y nunca presentada) | +3 mala_gestión |
| `desfavorable_leve` | +2 mala_gestión, **+ años desde inspección** como multiplicador suave (cuanto más tiempo sin reparar, peor) |
| `desfavorable_grave` | +4 mala_gestión, igual escalado por antigüedad |
| `no_procede` / `desconocido` | sin efecto |

Añadir `iee` al `breakdown` y a `avisos` del JSON que ya devuelve la función, para que sea visible en debug.

## UI
En `src/pages/comercial/EdificioDetalle.tsx` (cabecera + tarjeta de "Estado del edificio"), nuevo bloque **IEE/ITE**:
- Badge color según estado (verde / ámbar / rojo).
- Texto humano:
  - Favorable → "IEE favorable · próx. revisión: oct 2031 (5 a 2 m)".
  - Desfavorable → "IEE desfavorable desde mar 2022 (3 a 4 m sin corregir)".
  - Caducada → "IEE caducada desde feb 2024".
  - Pendiente → "Sin IEE presentado (obligado desde 2019)".
- Botón "Actualizar IEE" → invoca `fetch_iee_madrid`.

Idéntico badge compacto en `DocAlertBadge` para que aparezca también en listados de la cartera del comercial cuando es `desfavorable_grave`, `caducada` o `pendiente`.

## Cron
Cron job (cada noche, 200 edificios) que actualiza IEE de los que estén `desconocido` o `iee_actualizado_at` > 90 días, priorizando los de la cartera activa.

## Archivos a tocar
- migración SQL (columnas + enum + trigger + edición de `compute_cluster_score`)
- `supabase/functions/fetch_iee_madrid/index.ts` (nuevo)
- cron job (insert)
- `src/pages/comercial/EdificioDetalle.tsx`
- `src/components/buildings/DocAlertBadge.tsx`
- `src/components/settings/JobsManualPanel.tsx` (botón manual)

## No se toca
Detector de escaleras, lógica de proindiviso, voss_coach, scoring P0, mapping HubSpot.

## Preguntas
1. **Fuente exacta**: ¿confirmas usar la **consulta pública del Ayuntamiento de Madrid** (sede.madrid.es) por referencia catastral? ¿O ya tenéis un export oficial que prefieres subir como CSV y nos saltamos el scraping?
2. **Firecrawl**: para hacer el scraping de la sede necesito que conectes Firecrawl (lo gestiono con el botón estándar de Lovable). ¿Lo conectamos o prefieres una alternativa (subida manual por edificio)?
3. **Peso en el scoring**: ¿te valen los números de la tabla de arriba (+2/+3/+4 sobre mala_gestión), o quieres que IEE pese más/menos respecto a proindiviso y conflicto?
