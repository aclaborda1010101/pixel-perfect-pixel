## Qué está pasando ahora mismo

**1. "0 en cola" pero hay 2.935 pendientes reales.**
La edge function `score-calls-historical` hace:
```ts
.select(...).not("transcripcion","is",null).order("fecha", desc).limit(200)
```
y luego filtra en memoria las que ya tienen `metadatos.post_call_scoring`. Como las 200 más recientes ya están scoreadas, el filtro devuelve `[]` → `queue_remaining = 0` y la self-reinvocación se detiene. Por eso el proceso quedó parado en 200/3.135.

Comprobado en BBDD ahora mismo:
- 3.135 llamadas con transcripción
- 200 scoreadas
- **2.935 pendientes reales** (con transcripción y sin `post_call_scoring`)

**2. "Hitos conseguidos · sin datos".**
La página filtra `if (isComercial && user.email) rows = rows.filter(r => r.comercial === user.email)`. Tu rol es comercial y tu email de login no coincide con la columna `comercial` de la vista (que guarda el email del CRM, p.ej. `jesus.anzola@afflux.es`). Resultado: tabla vacía aunque la vista tiene datos.

**3. Se perdieron heatmap y comparativa antiguos.** Los quitamos al reemplazar la página.

## Plan

### A) Arreglar el scoring para que avance hasta agotar las 2.935

En `supabase/functions/score-calls-historical/index.ts`:

- Cambiar la query para **excluir en BBDD** las ya scoreadas, en vez de filtrar en memoria sobre las 200 más recientes:
  ```ts
  .not("transcripcion","is",null)
  .neq("transcripcion","")
  .or("metadatos.is.null,not(metadatos.cs.{\"post_call_scoring\":{}})")  // equivalente vía RPC si or() no soporta
  ```
  Si el operador `or` con `cs` no funciona limpio, crear una **vista o columna generada** `calls.score_pending boolean` o consultar vía `rpc` con SQL plano `WHERE NOT (metadatos ? 'post_call_scoring')`.
- Aumentar `BATCH` a 8 y mantener self-reinvocación.
- Devolver `queue_remaining` real (count total pendiente, no resto del fetch).
- Mantener compatibilidad con el re-score de filas viejas que ya tienen scoring antiguo sin `hits_total`.

### B) Mix de UI en `/productividad` (mantener nuevo + recuperar antiguo)

Estructura final de la página:

1. **Cabecera + acción "Reanalizar pendientes"** mostrando contadores reales:
   `200 scoreadas · 2.935 pendientes · 3.135 con transcripción`.
2. **KPIs globales de hitos** (los nuevos: hitos medios, score, %tipología/mueve/edif/canal). Ya están.
3. **Tabs:**
   - **Calidad por comercial (hitos)** — tabla de `v_productividad_comercial` (ya está).
   - **Comparativa clásica** — la tabla antigua (calls, dur. media, conversión, sentiment+, ratio, score técnica, última) leyendo `calls` con `outcome/sentiment/tecnica_score`.
   - **Heatmap día × hora** — los dos modos: "Cuándo llama" y "Cuándo convierte" (igual que antes).
   - **Duración (diagnóstico)** — ya está.
   - **Movimientos ganadores** — recuperar el bloque de tácticas y pivots (sobre `calls.pivot_moments` + `tacticas_usadas`).
   - **Coach IA** — ya está.
3. **Selector de comercial y rango** vuelve arriba (Todos / Comercial · 7d/30d/90d/365d), como antes. Aplica a la pestaña clásica, heatmap, movimientos y Coach IA. No aplica a la tabla de hitos (esa es agregada por la vista, sin filtrar por rango).

### C) Arreglar el filtro vacío por rol

Quitar el `filter(r => r.comercial === user.email)` ingenuo. En su lugar:
- Si `isComercial`, mapear `user.email → comercial_email` usando la tabla `calls` (igual que el mapa que ya cargamos para Coach IA). Si encontramos match → filtramos por ese email del CRM. Si no, mostramos todas las filas y un aviso ("no se pudo mapear tu cuenta a un comercial del CRM").

### D) Estado pendiente realista en el botón

`Reanalizar pendientes` debe:
- Llamar a `score-calls-historical` (igual).
- Refrescar contador con `count(*) WHERE transcripcion <> '' AND NOT (metadatos ? 'post_call_scoring')` (no el total con transcripción).

## Detalle técnico

- **Edge function fix prioridad**: si Supabase REST no permite filtrar `NOT (metadatos ? 'post_call_scoring')` desde el cliente, expondré una `rpc` SQL `get_pending_scoring_ids(limit int)` que devuelve IDs y la function los procesa por lote.
- **Heatmap / comparativa / movimientos**: se reaprovecha la lógica que tenía la versión anterior de `Productividad.tsx` (la borrada en el último cambio). La traigo de vuelta dentro de las nuevas pestañas, sin tocar nada de hitos.
- **Sin cambios de schema** salvo (opcionalmente) la `rpc` mencionada.

## Qué NO se toca

- Vistas `v_productividad_*` ya creadas: se mantienen.
- Prompt de scoring por hitos: se mantiene (es lo bueno).
- BaselineLlamadasCard: no se reintroduce salvo que lo pidas explícitamente (lo dejamos fuera porque era el panel "pre-sistema F3").
