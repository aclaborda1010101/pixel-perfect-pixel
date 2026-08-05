# Fase 0 — Fiabilidad antes de V5

Dos piezas independientes, ambas sin efectos en producción: una **simulación read-only** de la cola de llamadas y un **arreglo del bucle de realimentación del score**. No se crean tareas, no se recalcula nada en masa, no se despliega.

## 1. Simulación read-only de la cola de hoy

Nueva vista `v_cola_simulada` (solo lectura) que evalúa, edificio a edificio, los siete requisitos y devuelve una fila por pareja edificio–propietario con el resultado de cada checkpoint.

Checkpoints (cada uno PASS/FAIL con su valor observado):

| # | Requisito | Valor observado que se muestra |
|---|---|---|
| 1 | Nota simple asociada con `status='listo'` | id y fecha de la nota, o "sin nota" |
| 2 | Al menos un propietario | nº de propietarios |
| 3 | Todos los propietarios con cuota en la relación edificio–propietario | "X de Y con cuota" |
| 4 | Ninguna cuota marcada `cuota_match='aproximado'` | nº de cuotas aproximadas |
| 5 | Suma de cuotas entre 99 y 101 | suma exacta |
| 6 | Teléfono del propietario | teléfono presente / ausente |
| 7 | Sin guardas pendientes que afecten al edificio o al propietario | nº y guardas afectadas |

Salida por candidato: prioridad calculada, desglose de la fórmula y una explicación en castellano del tipo "Se propone porque el edificio puntúa 78, el propietario 62 y lleva 41 días sin contacto; la prioridad se calcula multiplicando score de edificio × score de propietario y aumentando un 3,3 % por cada día de cadencia vencida".

Salida de excluidos: la misma fila, con `apto=false` y `motivos_exclusion` como lista legible ("Sin nota simple en estado listo", "3 de 7 propietarios sin % de propiedad", "Suma de cuotas 84,5 %", "Guarda 2 pendiente").

Página nueva `/admin/cola-simulada` (solo admin): resumen arriba (candidatos aptos, excluidos por motivo), tabla de aptos con checkpoints en verde/rojo desplegables, y tabla de excluidos. **Sin ningún botón que escriba**: la página solo consulta. No se importa ni se invoca `assign_daily_call_queue` desde ella.

Los dos sistemas de tareas actuales (`building_tasks` / cola diaria y el módulo de guardas) quedan intactos.

## 2. Bug de realimentación del score

Confirmado en base de datos:

- `v_building_score.score = COALESCE(b_score_total, score_raw)` → la vista devuelve el total ya mezclado en vez del score del activo.
- `compute_score` lee `v_building_score.score` y lo guarda como score del activo.
- `compute_score_total` hace `0.60 × activo + 0.40 × propietarios` y escribe el resultado en `score_total` **y** en `score`.

Resultado: en cada ejecución el componente de propietarios se vuelve a ponderar sobre sí mismo y el score deriva.

Corrección propuesta (una migración, sin recálculo automático):

- `v_building_score`: el score del activo se expone siempre desde `score_raw`, sin `COALESCE` con `b_score_total`; el total sigue disponible en la columna `score_total`.
- `compute_score`: usar siempre `score_raw` como score del activo y escribirlo en `score_activo` en vez de en `buildings.score`.
- `compute_score_total`: mantiene 60/40 y sigue escribiendo `score_total`; `buildings.score` queda como espejo del total solo para compatibilidad de lectura.
- **No** se lanza `recompute-all-scores` ni ningún UPDATE masivo. Los valores existentes se quedan como están hasta que se apruebe el recálculo en un paso posterior.

## Archivos y migraciones

- Migración A (simulación): `CREATE VIEW public.v_cola_simulada` + grant de lectura a `authenticated`. Sin tablas nuevas.
- Migración B (score): `CREATE OR REPLACE VIEW public.v_building_score`, `CREATE OR REPLACE FUNCTION public.compute_score`, `compute_score_total`.
- `src/pages/admin/ColaSimulada.tsx` (nueva).
- `src/App.tsx`: ruta `/admin/cola-simulada`.
- `src/components/layout/AppSidebar.tsx`: entrada en el bloque admin.

## Pruebas de aceptación

1. `select count(*) from v_cola_simulada where apto` devuelve un número; toda fila apta tiene los 7 checkpoints en PASS.
2. Toda fila no apta tiene al menos un motivo de exclusión textual y ningún motivo vacío.
3. Un edificio con cuota `aproximado` aparece excluido por el checkpoint 4, no por otro.
4. Un edificio cuyas cuotas no sumen 99–101 aparece excluido con la suma visible.
5. La página no contiene ninguna escritura ni invocación de función de cola; tras abrirla, `select count(*) from building_tasks` no varía.
6. Score: ejecutar `compute_score_total` dos veces seguidas sobre el mismo edificio devuelve el mismo valor (hoy deriva).
7. `compute_score` sobre un edificio devuelve exactamente su `score_raw`.
8. Ningún `score_total` de `buildings` cambia por aplicar la migración (solo cambia al recalcular explícitamente ese edificio).
9. Las páginas de Scoring total y ficha de edificio siguen mostrando los mismos números que antes de la migración.