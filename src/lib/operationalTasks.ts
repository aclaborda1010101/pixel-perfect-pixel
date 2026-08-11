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
/**
 * Catálogo CANÓNICO compartido: se importa del Motor V5, no se reimplementa.
 * T7, T2 y T3 sueltos NO son códigos canónicos (T2/T3 solo como `T2_T3`).
 */
export const V5_CANONICAL_CODES = V5_TASK_CODES;

/** Códigos históricos de assign_daily_call_queue (T-07 existió y se etiqueta). */
const V5_HISTORIC_RX = /^T-0([1-9])$/;
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export type V5KeyFormat = "historic_call_queue" | "canonical";
export type V5KeyOrigin = "legacy" | "engine";

export type ParsedV5TaskKey = {
  /** Clave original. */
  key: string;
  /** Segmento tal cual aparece en la clave (`T-01`, `T2_T3`, ...). */
  rawCode: string | null;
  /** Código normalizado sin guion (`T1`, `T2_T3`, ...). */
  code: string | null;
  /** Generación de la clave, o null si la estructura no es reconocible. */
  format: V5KeyFormat | null;
  /** Procedencia: `legacy` (histórico, solo lectura) o `engine` (canónico). */
  origin: V5KeyOrigin | null;
  /** Código histórico sin equivalente canónico (T-07): nunca se convierte. */
  legacyOnly: boolean;
};

function isIsoDate(seg: string): boolean {
  if (!ISO_DATE_RX.test(seg)) return false;
  const t = Date.parse(`${seg}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === seg;
}

const unparsed = (key: string): ParsedV5TaskKey => ({
  key, rawCode: null, code: null, format: null, origin: null, legacyOnly: false,
});

/**
 * Parsea una task_key V5 de forma ESTRUCTURAL. Solo dos formatos completos:
 *   a) histórico: `v5:<YYYY-MM-DD>:T-01…T-09:<id>`   (4 segmentos)
 *   b) canónico:  `v5:<rules_version>:<code>:<building>:<subject>:<fp>` (6)
 *
 * En canónico el código se toma EXCLUSIVAMENTE del tercer segmento y debe
 * pertenecer al catálogo del Motor. Cualquier otra cosa (T7, T2, T3, T4_T9,
 * minúsculas, segmentos vacíos, de más o de menos, código fuera de posición)
 * se devuelve como V5 sin código: nunca degrada a Manual.
 */
export function parseV5TaskKey(taskKey: unknown): ParsedV5TaskKey | null {
  if (!isV5TaskKey(taskKey)) return null;
  const key = String(taskKey);
  const parts = key.split(":");
  if (parts[0] !== "v5") return unparsed(key);

  if (parts.length === 4) {
    const [, fecha, raw, id] = parts;
    if (!isIsoDate(fecha) || id.trim().length === 0) return unparsed(key);
    const m = V5_HISTORIC_RX.exec(raw);
    if (!m) return unparsed(key);
    const code = `T${m[1]}`;
    return {
      key, rawCode: raw, code,
      format: "historic_call_queue",
      origin: "legacy",
      legacyOnly: !isV5TaskCode(code),
    };
  }

  if (parts.length === 6) {
    const [, version, raw, building, subject, fingerprint] = parts;
    const filled = [version, building, subject, fingerprint].every((s) => s.trim().length > 0);
    if (!filled || !isV5TaskCode(raw)) return unparsed(key);
    return {
      key, rawCode: raw, code: raw,
      format: "canonical", origin: "engine", legacyOnly: false,
    };
  }

  return unparsed(key);
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
