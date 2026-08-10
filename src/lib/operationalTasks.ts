/**
 * Canonical visibility rule for `building_tasks`.
 *
 * Only two families of tasks are operational (visible + countable):
 *  - Manual tasks created by a human  -> task_type = 'manual'
 *  - V5 engine tasks                  -> task_key starts exactly with 'v5:'
 *
 * Everything else (legacy `auto` tasks from the retired buildingTasks engine,
 * old `call_queue:` keys, or any other key) is legacy noise: it must never be
 * shown in any screen nor counted in any metric.
 */

export const V5_TASK_KEY_PREFIX = "v5:";

export type OperationalTaskLike = {
  task_type?: string | null;
  task_key?: string | null;
};

/** Server-side equivalent of this helper, for PostgREST `.or(...)` filters. */
export const VISIBLE_OPERATIONAL_TASK_OR_FILTER = `task_type.eq.manual,task_key.like.${V5_TASK_KEY_PREFIX}*`;

export function isV5TaskKey(taskKey: unknown): boolean {
  return typeof taskKey === "string" && taskKey.startsWith(V5_TASK_KEY_PREFIX);
}

export function isVisibleOperationalTask(task: OperationalTaskLike | null | undefined): boolean {
  if (!task || typeof task !== "object") return false;
  if (task.task_type === "manual") return true;
  return isV5TaskKey(task.task_key);
}

export function filterVisibleOperationalTasks<T extends OperationalTaskLike>(tasks: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter(isVisibleOperationalTask);
}

/**
 * Extrae el código V5 (T1, T2_T3, T4, ...) de una task_key `v5:...`.
 * Soporta las dos formas en circulación:
 *   v5:<fecha>:<code>:<id>
 *   v5:<rules_version>:<code>:<building>:<subject>:<fingerprint>
 */
const V5_CODE_RX = /^T\d+(?:_T\d+)?$/;

export function v5TaskCodeFromKey(taskKey: unknown): string | null {
  if (!isV5TaskKey(taskKey)) return null;
  const parts = String(taskKey).split(":");
  for (const p of parts.slice(1)) {
    if (V5_CODE_RX.test(p)) return p;
  }
  return null;
}

export type OperationalTaskBadge = {
  label: string;
  variant: "info" | "outline" | "secondary";
};

/**
 * Etiqueta canónica de origen de una tarea.
 * Regla dura: `task_key` V5 manda SIEMPRE sobre `task_type`; una tarea V5 con
 * task_type='call_queue' jamás puede mostrarse como "Manual". Solo
 * task_type='manual' (y sin clave V5) se etiqueta "Manual".
 */
export function operationalTaskBadge(task: OperationalTaskLike | null | undefined): OperationalTaskBadge {
  if (isV5TaskKey(task?.task_key)) {
    const code = v5TaskCodeFromKey(task?.task_key);
    return { label: code ? `V5 · ${code}` : "V5", variant: "info" };
  }
  if (task?.task_type === "manual") return { label: "Manual", variant: "outline" };
  return { label: "Legacy", variant: "secondary" };
}
