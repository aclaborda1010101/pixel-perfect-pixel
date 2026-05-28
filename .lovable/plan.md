# Plan: Conteo correcto de ventanas + vistas aéreas para patios

## Diagnóstico

**Por qué siguen 35 ventanas en lugar de 47:**
El prompt actual dice "ejes × plantas tipo + ventanas planta baja". Gemini, al ver PB con escaparates/portal en vez de ventanas residenciales, decide **no sumar PB** ("no las sumes si solo es portal+local"). El entresuelo tampoco se cuenta porque el prompt no lo menciona. Resultado: faltan ~12 huecos (6 PB + 6 entresuelo).

**Vistas tipo Google Earth para patios:**
Las fotos que adjuntas son del cliente Google Earth (3D oblicuo) — no hay API pública directa para esa vista exacta. Pero **Google Maps Platform sí tiene Aerial View API** que devuelve renders 3D oblicuos en vídeo + thumbnails de cualquier dirección. Está disponible para Madrid. Otra opción complementaria: subir el zoom de las oblicuas estáticas (z19→z20) para ver mejor los patios desde arriba.

## Cambios

### 1. `analyze-building-vision/index.ts` — prompt fachada

Reescribir la sección "VENTANAS DE FACHADA":
- PB **SIEMPRE** cuenta como planta (aunque sea portal + locales). Cada portal/escaparate/persiana = 1 hueco = 1 eje.
- Si hay **entresuelo/entreplanta** (forjado intermedio visible), también cuenta como planta independiente.
- Fórmula nueva: `ventanas = ejes × (pb + entresuelo + plantas_tipo + atico)` — sin restas ni excepciones por uso comercial.
- Añadir campo `plantas_desglose: { pb, entresuelo, plantas_tipo, atico }` para auditar.
- Simetría obligatoria también para PB tapada por toldos/coches.

Actualizar `plantas_visibles` para que sea la suma del desglose.

### 2. `fetch-google-imagery/index.ts` — Aerial View API + oblicuas reforzadas

a) **Aerial View API** (mejor esfuerzo, gracioso si falla):
   - `POST aerialview/v1/videos:lookupVideo` con `address` del edificio.
   - Si devuelve `state: ACTIVE` con `uris.image`, guardar como `aerial_oblique.jpg` con `source: "aerial"`.
   - Si `404`/`NOT_FOUND` → llamar `videos:renderVideo` (dispara el render para la próxima vez) y seguir sin bloquear.
   - Llamada vía el secret `GOOGLE_MAPS_API_KEY` ya configurado (no requiere conector nuevo).

b) **Oblicuas reforzadas** (siempre): subir `oblique_45` y `oblique_225` de z19 a z20 y añadir `oblique_135` y `oblique_315` para tener 4 ángulos de patio.

### 3. `analyze-building-vision/index.ts` — prompt patios

Añadir al prompt: *"Si hay imágenes con source 'aerial' u 'oblique' que muestren los patios desde arriba, cuenta directamente las ventanas visibles en las paredes interiores del patio. Solo si no hay visibilidad, recurre a la heurística geométrica."*

Mantener la fórmula geométrica como fallback (ya está implementada).

### 4. UI — sin cambios

Las imágenes aéreas/oblicuas extra aparecen automáticamente en el carrusel existente.

## Validación

Tras desplegar:
1. Lanzar `fetch-google-imagery` + `analyze-building-vision` sobre **Díaz Porlier 47**.
2. Verificar que `plantas_desglose.pb = 1` y `ventanas_fachada_total ≈ 47`.
3. Verificar que aparezca `aerial_oblique.jpg` (o que el log muestre el render disparado en su defecto).

## Riesgos

- Aerial View API puede no tener cobertura para una dirección concreta o requerir minutos para renderizar la primera vez → manejado con fallback gracioso, no bloquea el resto del análisis.
- Más imágenes → más tokens al modelo → coste algo mayor, pero sigue dentro de límites.

¿Apruebas para implementar?
