
Cuatro entregables. Todo compatible hacia atrás: `buildings.score` sigue existiendo y pasa a ser `score_total` (fórmula nueva); `score_activo` queda como el score físico "de siempre".

## 1) Fix del sidebar

`src/components/layout/AppSidebar.tsx` — `active = pathname.startsWith(item.url)` marca `/comercial` como activo cuando estás en `/comercial/edificios`. Cambio:

```ts
const active =
  location.pathname === item.url ||
  location.pathname.startsWith(item.url + "/");
```

Así "Inicio" (`/comercial`) solo se ilumina en su ruta exacta.

## 2) Renombrar entrada del menú

En el array de `operativa` para el rol `comercial_zona`:

- `"Edificios"` → **"Scoring total"** (icono `Building2` se mantiene).

## 3) Score a dos ejes — SQL, recálculo en tiempo real, UI con toggle

### 3.a Migración: columnas y funciones

Nuevas columnas en `public.buildings`:

- `score_activo numeric` — copia del score físico actual.
- `score_propietarios numeric` — nuevo (0–100).
- `score_propietarios_breakdown jsonb` — desglose ({ señales, pesos, notas }).
- `score_total numeric` — combinado (fórmula abajo).
- `score_propietarios_updated_at timestamptz`.

`score` (columna legacy) queda como alias sincronizado a `score_total` para no romper la UI actual.

Fórmula del `score_total` (multiplicativa suavizada, documentada en el breakdown):

```
score_total = score_activo × (0.30 + 0.70 × score_propietarios / 100)
```

- `score_propietarios = 0` → `score_total = 0.30 × score_activo` (hunde).
- `score_propietarios = 100` → `score_total = score_activo` (máximo).
- `score_propietarios = 50` → `score_total = 0.65 × score_activo`.

### 3.b Función `compute_owner_score(p_building_id)`

Agrega señales por edificio a partir de:

- `owners` vinculados vía `building_owners`.
- `owner_call_prep_cache.kpis_json` (predisposición_a_vender, necesidad_liquidez, urgencia, oferta_previa, quien_bloquea, tipologia_confirmada, cobertura_kpi).
- Perfil (`owners.buyer_persona`, tipología T1–T10 normalizada).
- Llamadas analizadas (`call_sessions.voss_post`, `kpis_conseguidos`).
- Cuota de propiedad (`building_owners.cuota`).

Puntuación (0–100), suma de deltas partiendo de 50:

| Señal (ponderada por cuota si aplica) | Δ |
|---|---|
| Predisposición: "quiere/necesita vender" | +18 por propietario ponderado |
| Predisposición: "condicionado" | +6 |
| Predisposición: "bloqueado / no quiere" | −20 |
| Urgencia declarada (herencia, deuda, mudanza) | +10 |
| Necesidad de liquidez confirmada | +8 |
| Oferta previa concreta discutida | +6 |
| Tipología T1 / T2 / T5 / T7 | +4 cada uno |
| Tipología T3 / T6 | −3 |
| Nº propietarios ≥ 4 | +6 (más puertas) |
| Nº propietarios = 1 y bloqueado | −25 (mata) |
| Cobertura KPI (% propietarios cualificados) | +0..+10 lineal |
| Todos los contactados cerrados | tope score ≤ 15 |

Clamp 0–100. Guarda breakdown JSON con cada señal, contribuyente y evidencia (call_id / owner_id).

### 3.c Recálculo del edificio

`compute_score_total(building_id)` recalcula `score_activo` (mantiene lógica existente de `compute_score`), llama `compute_owner_score`, aplica la fórmula multiplicativa, escribe las 4 columnas.

### 3.d Trigger en tiempo real post-llamada

- Trigger `AFTER UPDATE OF kpis_conseguidos, voss_post ON call_sessions` → resuelve `building_id` del owner asociado y recalcula.
- Trigger `AFTER INSERT OR UPDATE ON owner_call_prep_cache` → recalcula edificios asociados al owner.
- Función `pg_notify` opcional para invalidar caché front (fuera de scope inmediato).

Así, cuando el auto-análisis de 15m escribe el resultado, el score del edificio se mueve solo.

### 3.e UI

`src/pages/comercial/Edificios.tsx` y `EdificioDetalle.tsx`:

- Toggle en la cabecera: **"Sin propietarios"** (checkbox). ON → ordena y muestra `score_activo`; OFF (default) → `score_total`.
- `BuildingCard` muestra:
  - `ScorePill` con el score activo (total o activo según toggle).
  - Chip fino con los tres: **`Activo 86 · Propietarios 45 · Total 62`**.
- En la ficha, panel "Scoring" añade barra dual (Activo / Propietarios) y texto: "El score total se hunde porque los propietarios están cerrados".

Estado del toggle sincronizado con `?view=activo|total` en URL para poder compartir.

## 4) Productividad — rediseño orientado a coaching

`src/pages/Productividad.tsx` reescrita en 4 secciones (una pestaña cada una, KPI cabecera compartido). Todo se alimenta de datos existentes: `calls`, `call_sessions.puntuacion`, `call_sessions.kpis_conseguidos`, `call_sessions.voss_post.mejoras|fortalezas`, `coach_reports`.

### Sección 1 · Foto semanal por comercial

Por comercial (Jesús / David / resto), tarjeta con:

- **Intentos** (llamadas totales), **Conectadas** (`duracion_seg ≥ 30`), **% conexión**.
- **Nota media** (media de `call_sessions.puntuacion` de esta semana).
- **Δ semana vs anterior** (badge verde/rojo con tendencia).
- **KPIs / conectada** — media de `kpis_conseguidos.length` entre conectadas.
- **Pendientes**: nº de llamadas conectadas sin analizar + nº de "siguientes llamadas propuestas" con fecha vencida.

### Sección 2 · Qué mejorar (top patrones)

Agrupa `voss_post.mejoras[]` de las llamadas analizadas del comercial (últimos 30 días), normaliza por keyword/etiqueta y muestra top 3 con:

- Etiqueta del patrón, nº de veces detectado.
- Ejemplo real (link al expediente `/comercial/llamada/:hsId`).

### Sección 3 · Qué hace bien

Mismo agregador con `voss_post.fortalezas[]` — top 3 técnicas recurrentes con ejemplo.

### Sección 4 · Actividad por edificio y pendientes

Tabla ligera:

- Edificios trabajados esta semana (llamadas + owners contactados).
- Cola de "siguientes llamadas" propuestas por VOSS con fecha objetivo → botón "Preparar" → `/comercial/edificios/{id}/preparar/{ownerId}`.

### Sección 5 · Comparativa sana

Radar Jesús vs David (conexión %, nota media, KPIs/conectada, análisis realizados) — sin ranking numérico, foco en spread.

Mantengo las vistas legacy (`v_productividad_comercial/global` y "Movimientos ganadores") en una pestaña **"Legacy"** por si Carlos quiere consultar histórico.

## Detalles técnicos

**Migraciones (una sola):**
1. `ALTER TABLE public.buildings ADD COLUMN score_activo/score_propietarios/score_propietarios_breakdown/score_total/score_propietarios_updated_at`.
2. Backfill: `score_activo := score`, `score_propietarios := NULL` → recomputará al primer trigger.
3. `CREATE FUNCTION compute_owner_score(uuid) RETURNS jsonb`.
4. `CREATE FUNCTION compute_score_total(uuid) RETURNS void`.
5. Triggers `AFTER UPDATE ON call_sessions` y `AFTER INSERT OR UPDATE ON owner_call_prep_cache`.
6. Job de backfill: recomputar `score_total` para todos los edificios en batches (cron nocturno). Primera ejecución manual.

**Front:**
- `src/pages/comercial/Edificios.tsx` — toggle, columnas nuevas en query slim.
- `src/components/comercial/scoring.tsx` — helper `ScoreDualChip` (Activo · Propietarios · Total).
- `src/pages/comercial/EdificioDetalle.tsx` — panel Scoring con las dos barras.
- `src/pages/Productividad.tsx` — reescritura en 4 secciones nuevas + pestaña Legacy.
- `src/components/layout/AppSidebar.tsx` — fix active + rename.

**Riesgos / trade-offs:**

- Recomputar `score_total` para 1.156 edificios costará ~2–4 min de CPU en el primer backfill. Se hace en batches de 50 vía función SQL.
- Si `owner_call_prep_cache.kpis_json` no tiene todavía datos ricos para un edificio, `score_propietarios` cae al valor neutro (50) y no penaliza — así los edificios sin trabajar no se hunden artificialmente.

**Fuera de scope aquí (lo pregunto si lo quieres):**

- Cambiar el ranking o alertas basadas en score (mantengo las actuales).
- Notificaciones push cuando un `score_total` cae bruscamente.
