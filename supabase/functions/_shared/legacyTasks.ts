/**
 * CONTENCIÓN LEGACY — el motor legacy de tareas está RETIRADO.
 *
 * Ninguna función de enriquecimiento puede volver a escribir en
 * `building_tasks`. Las incidencias que antes generaban una tarea automática
 * NO se convierten en tarea manual ni en tarea V5: se registran como
 * incidencia informativa y el resto del flujo continúa con honestidad.
 *
 * Únicos escritores permitidos de `building_tasks`:
 *  - motor V5 productivo/simulación aprobada (assign_daily_call_queue)
 *  - creación manual desde la UI
 */
export const LEGACY_TASK_ENGINE_RETIRED = true;

export const LEGACY_TASK_ENGINE_NOTE =
  "motor legacy de tareas retirado: no se crea building_task";

export type LegacyTaskSkip = {
  legacy_task_engine_retired: true;
  task_created: false;
  reason: string;
  incidencia: string;
  contexto: Record<string, unknown>;
};

/**
 * Devuelve el registro honesto de una incidencia que ANTES creaba una tarea
 * automática. No escribe nada en ninguna tabla.
 */
export function legacyTaskSkip(
  incidencia: string,
  contexto: Record<string, unknown> = {},
): LegacyTaskSkip {
  return {
    legacy_task_engine_retired: true,
    task_created: false,
    reason: LEGACY_TASK_ENGINE_NOTE,
    incidencia,
    contexto,
  };
}