# Cotejo refcatastrales + Fix enlace "Abrir plano catastral SVG"

## 1. Cotejo con `refcatastrales_79_LOVABLE.numbers`

He cruzado los 79 edificios. **73 coinciden**. **6 con discrepancia** entre la refcat de la BD (Lovable/HubSpot) y la real de Catastro OVC:

| Edificio | building_id | Refcat BD (Lovable) | Refcat real OVC | Acción sugerida |
|---|---|---|---|---|
| **Cava Baja 42** | `0485d8cf…` | ~~9441101VK3794A0001FT~~ | **9839518VK3793H0001FT** | BD ya tiene la correcta ✅ (corregido en pasos previos) |
| **Ciudad Rodrigo 51 / 5** | `d7ba43d2…` | 0728703VK4702H0001KP | 0043101VK4704C0001 | Confirmar primero si la dirección real es 51 o 5 |
| **General Margallo 13** | `5786db99…` | 0600802VK4800B0001EL | 1093403VK4719C0001LL | Sustituir por la OVC |
| **José Ortega y Gasset 46** | `9a830bdc…` | 2352407VK4725C (truncada, 14 chars) | 2658202VK4725H0001DM | Sustituir por la OVC |
| **Ruda 19** | `48f3e17f…` | 9538907VK3793H0001MT | 0037102VK4703E0001WM | Verificar manualmente (posible homonimia) |
| **Málaga 51 / 5** | sin building_id | ? | 1269711VK4716G0001 | Confirmar dirección |

Además:
- **Labrador 19** y **Serrano 8** existen en Catastro pero **no están sincronizados** en Lovable.

## 2. Bug "Abrir plano catastral SVG" devuelve 404

Causa raíz confirmada en BD/Storage:
- `catastro_data.plano_url` para Cava Baja 42 apunta a `…/catastro/9839518VK3793H0001FT.svg`.
- Ese fichero **no existe** en el bucket `catastro` (sólo están los `_plantas.pdf` y `_plantas_pX.png`).
- En `supabase/functions/fetch-catastro-data/index.ts` (líneas 165-185), el código guarda `plano_url` con `getPublicUrl(svgPath)` **siempre**, incluso si el fetch al endpoint `GeneraGraficoParcela.aspx` no devolvió `<svg>` (frecuente: Catastro OVC bloquea por bot/UA o devuelve HTML con imagen rasterizada).

## 3. Cambios a implementar

### a) Edge function `fetch-catastro-data`
- Sólo setear `plano_url` cuando el upload del SVG haya tenido éxito; en caso contrario dejarlo `null` y registrar el motivo en `fetch_error` (sin abortar el resto).
- Reintento simple del fetch al SVG con `User-Agent` de navegador y `Accept: image/svg+xml,*/*`.

### b) UI `CatastroDetalladoCard.tsx`
- Si `plano_url` es `null`, mostrar texto deshabilitado "Plano SVG no disponible en Catastro" en vez del link que rompe.
- Añadir botón de "Reintentar descarga SVG" que invoca de nuevo la edge function para esa refcat.

### c) Re-ejecutar `fetch-catastro-data` para Cava Baja 42
- Limpia el `plano_url` actual (huérfano) y deja el estado coherente.

### d) Migración correctiva opcional (solo tras confirmación del usuario)
Para las 4 discrepancias claras (Margallo 13, Ortega y Gasset 46, Ciudad Rodrigo, Málaga), `UPDATE buildings SET refcatastral=…` y re-procesar.

## Pregunta antes de implementar
¿Aplico también **(d)** las correcciones de refcatastral para General Margallo 13 y Ortega y Gasset 46 ahora (las 2 inequívocas), y dejo Ciudad Rodrigo / Ruda / Málaga pendientes de tu confirmación de dirección?
