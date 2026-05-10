## Coach IA causal: momentos pivote y tácticas

Cambio del modelo de "frases ganadoras" (correlación) a **momentos pivote** (causa): detectar dentro de cada transcripción cuándo el cliente cambia de estado y qué hizo el comercial justo antes.

### 1. Migration

`ALTER TABLE calls`:
- `pivot_moments jsonb DEFAULT '[]'::jsonb`
- `tacticas_usadas text[] DEFAULT '{}'`

Schema de cada `pivot_moment`:
```json
{
  "posicion_relativa": 0.42,
  "estado_cliente_antes": "resistente",
  "trigger_frase": "Entiendo que ya lo intentó con otra agencia y no salió. ¿Qué fue exactamente lo que falló?",
  "tactica": "validacion_emocional",
  "estado_cliente_despues": "considerando",
  "impacto": "alto",
  "objecion_neutralizada": "ya_intentado"
}
```

Tácticas válidas: `preguntas_abiertas`, `neutralizacion_objecion`, `reframe`, `validacion_emocional`, `prueba_social`, `personalizacion`, `urgencia_legitima`, `escucha_activa`, `cierre_directo`.

Estados antes: `cerrado | resistente | esceptico | dudoso | abierto`.
Estados después: `curioso | considerando | comprometido | sigue_cerrado | cerrado_negativo`.
Impacto: `alto | medio | bajo`.

Índice GIN sobre `pivot_moments` y `tacticas_usadas` para filtrado rápido.

### 2. Edge function `analyze_call`

- Reescribir el prompt en castellano. Pasos: leer transcripción entera, identificar 0–5 momentos donde el cliente cambia de estado, para cada uno extraer la **frase exacta del comercial inmediatamente anterior** (1–2 oraciones literales), clasificar táctica, estado antes/después, impacto, objeción neutralizada (opcional).
- Si no hay pivots → `[]` (no inventar).
- Mantener campos previos (`outcome`, `sentiment`, `objeciones`, `tecnica_score`, etc.) y añadir `pivot_moments` + `tacticas_usadas` (derivado del set de `tactica` de los pivots).
- Aceptar `force_reanalyze: true` en el body batch: ignora `analyzed_at IS NULL` y procesa por orden de fecha.
- `MAX_PER_RUN=20`, encadena con `EdgeRuntime.waitUntil` mientras queden pendientes. Cursor en `hubspot_sync_state` entity `analyze_calls_recall`.

### 3. Recall sobre 2.546 calls

- Ejecutar `analyze_call` con `{ chain: true, force_reanalyze: true }` y dejar que se encadene en chunks de 20.
- Una vez terminado (`pending=0`), correr query agregada y reportar:
  - Total recalculadas
  - Distribución de tácticas (count por táctica)
  - Distribución de impacto (alto/medio/bajo)
  - Top 5 pivot_moments con `impacto=alto` (frase + táctica + comercial)
  - Ratio pivot_moments por call (avg, p95)

### 4. UI: sub-tab "Movimientos ganadores"

En `Productividad.tsx`, renombrar `Objeciones & frases` → `Movimientos ganadores`.

Reemplazar listas de frases sueltas por tarjetas tipo:

```text
[ resistente ] → validacion_emocional → "Entiendo que ya lo intentó..." → [ considerando ]   impacto: alto
```

Filtros (popover): táctica (multi), buyer_persona del owner, comercial. Datos: query directa a `calls` filtrando `pivot_moments` + join a `owners` para buyer_persona.

### 5. Coach IA causal

Reescribir prompt de `generate_coach_report`:
- Input: pivot_moments + métricas del comercial en el rango.
- Output JSON: 
  - `top_pivots` (3 momentos propios alto-impacto con contexto)
  - `tacticas_efectivas` / `tacticas_fallidas` (con ratios)
  - `recomendaciones` (texto contextual por buyer_persona + objeción)
  - `plan_accion` (3–5 pasos)
- La `CoachCard` en frontend renderiza esos bloques nuevos.

### 6. Dashboard tile "Táctica más efectiva"

En `Productividad.tsx` (tab Resumen), añadir tile que calcule sobre los últimos 30d: `tactica` con mayor ratio `impacto=alto / total_uso`. Muestra nombre, ratio, count.

### Reglas

- HubSpot read-only.
- Idempotente: `pivot_moments` se sobrescribe en cada análisis.
- `MAX_PER_RUN=20`, encadenado.
- `force_reanalyze=true` solo para esta recalibración.

### Entregables al final

1. Migration aplicada.
2. `analyze_call` redeployed y validado en 1 call.
3. Recall de 2.546 completo + reporte agregado.
4. UI "Movimientos ganadores" funcionando.
5. Coach IA con output causal.
6. Tile "Táctica más efectiva" en dashboard.
