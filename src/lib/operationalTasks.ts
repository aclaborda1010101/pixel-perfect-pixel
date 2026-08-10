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
