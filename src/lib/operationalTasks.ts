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
 * Extrae el código V5 de una task_key `v5:...`. Hay DOS generaciones reales
 * en circulación y ninguna es "Manual":
 *
 *  - legacy productiva (assign_daily_call_queue): `v5:<YYYY-MM-DD>:T-01:<uuid>`
 *    con el catálogo con guion T-01…T-09 (T-07 excluido).
 *  - canónica nueva (motor V5): `v5:<rules_version>:T2_T3:<building>:<subject>:<fp>`
 *    con los códigos T1, T2_T3, T4, T5, T6, T8, T9.
 *
 * El código se normaliza SIEMPRE a la forma canónica sin guion ni ceros
 * (`T-01` -> `T1`), y se devuelve además el formato de origen.
 */
/** Códigos canónicos admitidos por el catálogo V5 (T7 no existe: peso 0). */
export const V5_CANONICAL_CODES = ["T1", "T2_T3", "T2", "T3", "T4", "T5", "T6", "T8", "T9"] as const;

const V5_CANONICAL_RX = /^T[1-9](?:_T[1-9])?$/;
const V5_LEGACY_RX = /^T-0([1-9])$/;

export type V5KeyFormat = "legacy_call_queue" | "canonical";

export type ParsedV5TaskKey = {
  /** Clave original. */
  key: string;
  /** Segmento tal cual aparece en la clave (`T-01`, `T2_T3`, ...). */
  rawCode: string | null;
  /** Código normalizado sin guion (`T1`, `T2_T3`, ...). */
  code: string | null;
  /** Generación de la clave, o null si no se reconoce el código. */
  format: V5KeyFormat | null;
};

/**
 * Parsea una task_key V5. Devuelve null SOLO si la clave no es V5 en absoluto.
 * Una clave V5 con código irreconocible se devuelve con `code: null`: sigue
 * siendo V5 y jamás debe degradarse a "Manual".
 */
export function parseV5TaskKey(taskKey: unknown): ParsedV5TaskKey | null {
  if (!isV5TaskKey(taskKey)) return null;
  const key = String(taskKey);
  for (const seg of key.split(":").slice(1)) {
    if (V5_CANONICAL_RX.test(seg)) {
      return { key, rawCode: seg, code: seg, format: "canonical" };
    }
    const legacy = V5_LEGACY_RX.exec(seg);
    if (legacy) {
      return { key, rawCode: seg, code: `T${legacy[1]}`, format: "legacy_call_queue" };
    }
  }
  return { key, rawCode: null, code: null, format: null };
}

export function v5TaskCodeFromKey(taskKey: unknown): string | null {
  return parseV5TaskKey(taskKey)?.code ?? null;
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
  const parsed = parseV5TaskKey(task?.task_key);
  if (parsed) return { label: parsed.code ? `V5 · ${parsed.code}` : "V5", variant: "info" };
  if (task?.task_type === "manual") return { label: "Manual", variant: "outline" };
  return { label: "Legacy", variant: "secondary" };
}
