
## Diagnóstico

`fetch-catastro-data` tiene un bug: cuando un edificio ya trae `buildings.refcatastral` rellenado (caso de 73/74 tras el backfill), entra en el `if (!refcat || force)` de la línea 101 y **lo salta entero**. Eso significa que **nunca geocodifica ni llama a RCCOOR**, por lo que el upsert posterior (líneas 160-163) escribe sólo `refcatastral + building_id`, dejando `lat/lon = NULL` en `catastro_data`.

Consecuencia:
- La función devuelve `200 ok` → orquestador cuenta `catastro: ok 74/74`.
- `fetch-google-imagery` lee lat/lon → falla con `HTTP 400: Sin coordenadas`.
- Confirmado en BD: 74 edificios cartera_demo, sólo 1 con `lat`. El nuevo job `174e316d` está repitiendo el mismo error (52 "ok" pero sin coords).

## Cambios

### 1. `supabase/functions/fetch-catastro-data/index.ts`

Mover la geocodificación a un **paso siempre ejecutado** cuando faltan coords, independiente de si ya hay refcat:

- Después de cargar el building, leer la fila actual de `catastro_data` (si existe) para saber si ya hay `lat/lon`.
- Si **no hay lat/lon** (o `force`): ejecutar Nominatim → obtener `(lat, lon)`. Si falla → devolver **HTTP 422** y marcar `fetch_error` (no 200).
- Si **no hay refcat**: con esas coords llamar a RCCOOR para resolverlo. Si falla → HTTP 422 + `fetch_error`.
- Hacer un único `upsert` a `catastro_data` con `refcatastral`, `building_id`, `lat`, `lon` (sólo si los tenemos) **antes** de seguir con SVG/PDF/DNPRC.
- En caso de cualquier excepción no controlada, escribir `fetch_error` y devolver no-200.

### 2. Abortar los jobs antiguos en curso

Marcar como `aborted` los dos jobs (`ea300eb6…` y `174e316d…`) — ya no merece la pena que sigan.

### 3. Re-lanzar el batch limpio

Una vez deployada la edge function corregida, lanzar un nuevo `auto-process-cartera-demo` desde el botón existente. Procesará en orden:
- Fase A catastro → ahora sí escribirá lat/lon para los 73 que faltan + reintentará el PDF/SVG.
- Fase B Google → ya no fallará por falta de coords.
- Fase C Vision + Fase D Score → normales.

### 4. Verificación post-batch

Tras terminar, query a `catastro_data` filtrando `cartera_demo_seed=true` para confirmar:
- `COUNT(lat)` = 74
- `COUNT(plano_url)` + `COUNT(plantas_pdf_url)` cercanos a 74 (los que OVC sirva)
- `fetch_error` sólo en los irrecuperables, documentado.

## Fuera de scope

- No tocamos el orquestador (`auto-process-cartera-demo`) ni `fetch-google-imagery`: el bug es 100% de catastro.
- No bajamos concurrencia: 2 paralelos + 2 s sleep ya está siendo bien tolerado por OVC (74/74 respondieron 200).
- Dashboard de validación seed_label vs IA en /admin se queda para después del batch, como acordamos.
