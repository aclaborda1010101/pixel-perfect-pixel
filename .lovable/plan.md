# Análisis (solo lectura) del generador de cola de llamadas

## 1. Cómo selecciona candidatos
`assign_daily_call_queue` (POST, body `{user_id, n}`):
- Con `user_id`, lee `building_assignments` (status `active`) de ese usuario. Si no hay ninguna, devuelve `{ok:true, inserted:0, reason:'no_assignments'}` y no crea nada.
- Consulta `v_call_queue_daily` (límite 500) filtrando por esos `building_id`.
- La vista une `building_owners` + `owners` (exige `telefono` no vacío) + `v_building_score` + `v_owner_score`. `temperatura='hot'` si hay llamada en los últimos 60 días, si no `cold`. Orden: `prioridad = score_edificio * score_owner * (1 + dias_cadencia_vencida/30)`.
- La función deduplica por `building_id:owner_id`.

## 2. Cuántas tareas y mezcla T-02/T-08
- `n` entre 5 y 50 (por defecto 20): 60% hot + 40% cold (n=20 → 12 hot + 8 cold; si faltan hot, genera menos).
- **No existe lógica T-02/T-08 en el generador.** Sus títulos son `Llamar a <nombre> (hot|cold)` con prioridad `high`/`medium`. Las 79 tareas actuales llevan títulos `T-02 Primera llamada…` / `T-08 Seguimiento interesado…` y prioridad `normal`: **se insertaron manualmente por SQL, no con esta función**. No hay cron que la invoque.

## 3. task_key y due_date
- `task_key = call_queue:<YYYY-MM-DD de hoy, UTC>:<owner_id>`.
- **La función no escribe `due_date` (queda NULL).** El reparto 4/5/6/7 de agosto vino del insert manual.

## 4. ¿Borrar las 79 y ejecutar hoy daría una cola correcta?
No tal cual, por tres motivos verificados en base:
- **David (67dc7846…) no tiene ningún `building_assignments` activo** (los 151 activos son de 629f43a0… con 77 y de 4c05aaaa… con 74). Para David devolvería `inserted:0 / no_assignments`.
- **Faltan hot**: en los edificios de Jesús la vista da 297 cold y solo **3 hot**; con n=20 saldrían ~11 tareas (3 hot + 8 cold).
- Las nuevas tendrían `due_date` NULL (se verían “Sin fecha límite”, nunca “Hoy”/“Vencida”) y perderían el etiquetado T-02/T-08 que hoy muestra la UI.

Reparto actual pendiente: David 40 (10 por día 4–7), Jesús 39 (10/10/10/9).

## 5. Llamada exacta
Edge function `assign_daily_call_queue`, una invocación por comercial:

```text
POST /functions/v1/assign_daily_call_queue
{"user_id":"629f43a0-2e80-4be1-a402-516fddcabee9","n":20}
{"user_id":"67dc7846-c5a4-42b3-91b7-b802ced25382","n":20}
```

o desde el front `supabase.functions.invoke('assign_daily_call_queue', { body: { user_id, n: 20 } })` — es lo que ya hace `ColaHoyCard`.

## Qué haría falta antes de regenerar (propuesta, no ejecutada)
1. Crear/activar `building_assignments` para David (o asignación por zona).
2. Que el generador escriba `due_date` (hoy) y, si se quiere conservar la nomenclatura, títulos T-02 (sin contactos previos) / T-08 (con contacto previo).
3. Rellenar con cold hasta `n` cuando no haya hot suficientes.

Este análisis no ha cambiado código ni datos.
