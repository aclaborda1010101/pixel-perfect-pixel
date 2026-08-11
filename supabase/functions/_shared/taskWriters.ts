/**
 * ÚNICO escritor autorizado de `building_tasks` en el lado servidor.
 *
 * Contención legacy: ninguna función edge puede hacer `.insert()` directo
 * sobre `building_tasks`. La cola diaria V5 (assign_daily_call_queue) pasa
 * por aquí, y aquí se valida el contrato de la fila antes de escribir.
 */

/**
 * Clave HISTÓRICA (writer legacy, flag OFF): `v5:<YYYY-MM-DD>:T-0X:<id>`.
 * Solo formato de fecha + catálogo con guion. Nada canónico entra por aquí.
 */
export const V5_TASK_KEY_RX =
  /^v5:\d{4}-\d{2}-\d{2}:T-0[1-9]:[A-Za-z0-9_.:-]+$/;

/** Clave CANÓNICA del Motor: `v5:<version>:<code>:<building>:<subject>:<fp>`. */
export const V5_CANONICAL_TASK_KEY_RX =
  /^v5:[^:]+:(T1|T2_T3|T4|T5|T6|T8|T9):[^:]+:[^:]+:[^:]+$/;

export const V5_CANONICAL_TASK_CODES = ["T1", "T2_T3", "T4", "T5", "T6", "T8", "T9"] as const;

/** Catálogo HISTÓRICO real de la cola legacy. T-07 existió pero NUNCA se genera. */
export const LEGACY_HISTORIC_TASK_CODES = [
  "T-01", "T-02", "T-03", "T-04", "T-05", "T-06", "T-07", "T-08", "T-09",
] as const;
/** Códigos que un writer podría haber generado (T-07 es sólo de lectura). */
export const LEGACY_GENERABLE_TASK_CODES = LEGACY_HISTORIC_TASK_CODES.filter((c) => c !== "T-07");

export type LegacyHistoricTaskKey = {
  fecha: string;
  code: (typeof LEGACY_HISTORIC_TASK_CODES)[number];
  id: string;
  /** true para T-07: legible en el histórico, jamás generable. */
  legacyOnly: boolean;
};

/** Fecha de CALENDARIO real (no 2026-02-31 ni 2026-13-01). */
export function isRealCalendarDate(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Lectura ESTRICTA de una clave histórica: exactamente 4 segmentos,
 * `v5` + fecha de calendario real + código del catálogo histórico + id no
 * vacío y sin ':'. Devuelve null si algo no encaja (fail-closed).
 */
export function parseLegacyHistoricTaskKey(taskKey: unknown): LegacyHistoricTaskKey | null {
  if (typeof taskKey !== "string") return null;
  const seg = taskKey.split(":");
  if (seg.length !== 4) return null;
  const [pref, fecha, code, id] = seg;
  if (pref !== "v5") return null;
  if (!isRealCalendarDate(fecha)) return null;
  if (!(LEGACY_HISTORIC_TASK_CODES as readonly string[]).includes(code)) return null;
  if (!id || id.trim() === "" || id.includes(":")) return null;
  return { fecha, code: code as LegacyHistoricTaskKey["code"], id, legacyOnly: code === "T-07" };
}

/**
 * Validación de una fila histórica LEÍDA de `building_tasks`. No autoriza
 * ninguna escritura: el writer legacy está RETIRADO (Motor V5 P0.3).
 */
export function assertLegacyHistoricTaskRow(row: unknown): asserts row is LegacyHistoricTaskRow {
  const r = (row ?? {}) as Record<string, unknown>;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!nonEmpty(r.building_id)) throw new Error("v5 histórica: building_id obligatorio");
  if (!nonEmpty(r.user_id)) throw new Error("v5 histórica: user_id obligatorio");
  if (r.task_type !== "call_queue") throw new Error("v5 histórica: task_type debe ser call_queue");
  const parsed = parseLegacyHistoricTaskKey(r.task_key);
  if (!parsed) throw new Error(`v5 histórica: task_key inválida (${String(r.task_key)})`);
  if (r.generation_mode !== undefined && r.generation_mode !== "legacy") {
    throw new Error("v5 histórica: generation_mode sólo puede ser legacy");
  }
  if (!nonEmpty(r.title)) throw new Error("v5 histórica: title obligatorio");
  if (!nonEmpty(r.due_date)) throw new Error("v5 histórica: due_date obligatorio");
}

export type LegacyHistoricTaskRow = {
  building_id: string;
  user_id: string;
  task_type: "call_queue";
  task_key: string;
  title: string;
  due_date: string;
};

/**
 * WRITER LEGACY RETIRADO. Se conserva el símbolo para que la guarda de
 * arquitectura detecte cualquier intento de resucitarlo: importarlo o
 * llamarlo es una violación y, en ejecución, lanza siempre.
 */
export const LEGACY_CALL_QUEUE_WRITER_RETIRED = true;

type ClientLike = { from: (table: string) => any };

/**
 * Fila CANÓNICA del Motor V5 (generation_mode='production'). Exige la clave
 * completa de 6 segmentos Y todas las columnas Motor en concordancia exacta
 * con los segmentos de la clave (mismo contrato que los CHECK de la BD).
 */
export type V5CanonicalTaskRow = {
  building_id: string;
  user_id: string;
  task_type: "call_queue";
  task_key: string;
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high";
  status: "pending";
  due_date: string;
  starts_at: string;
  generation_mode: "production";
  rules_version: string;
  task_code: string;
  subject_type: "owner" | "building";
  subject_id: string;
  trigger_fingerprint: string;
  eligibility_snapshot: Record<string, unknown>;
  mode_snapshot: Record<string, unknown>;
};

export type CanonicalWriteOpts = { now?: number | Date };

export function assertV5CanonicalTaskRow(
  row: unknown, opts: CanonicalWriteOpts = {},
): asserts row is V5CanonicalTaskRow {
  const r = (row ?? {}) as Record<string, unknown>;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const isObj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  for (const f of [
    "building_id", "user_id", "task_key", "title", "rules_version", "task_code",
    "subject_id", "trigger_fingerprint", "due_date", "starts_at",
  ]) {
    if (!nonEmpty(r[f])) throw new Error(`v5 canónica: ${f} obligatorio`);
  }
  if (r.task_type !== "call_queue") throw new Error("v5 canónica: task_type debe ser call_queue");
  if (r.generation_mode !== "production") throw new Error("v5 canónica: generation_mode debe ser production");
  if (r.status !== "pending") throw new Error("v5 canónica: status inicial debe ser pending");
  if (!["low", "medium", "high"].includes(String(r.priority))) {
    throw new Error("v5 canónica: priority inválida");
  }
  if (!(V5_CANONICAL_TASK_CODES as readonly string[]).includes(String(r.task_code))) {
    throw new Error(`v5 canónica: task_code fuera de catálogo (${String(r.task_code)})`);
  }
  if (!["owner", "building"].includes(String(r.subject_type))) {
    throw new Error("v5 canónica: subject_type inválido");
  }
  if (!isObj(r.eligibility_snapshot) || !isObj(r.mode_snapshot)) {
    throw new Error("v5 canónica: snapshots deben ser objetos");
  }
  const key = String(r.task_key);
  if (!V5_CANONICAL_TASK_KEY_RX.test(key)) {
    throw new Error(`v5 canónica: task_key inválida (${key})`);
  }
  // FECHAS: instantes válidos, ventana coherente y jamás nacidas vencidas.
  const nowMs = opts.now === undefined
    ? Date.now()
    : (opts.now instanceof Date ? opts.now.getTime() : Number(opts.now));
  if (!Number.isFinite(nowMs)) throw new Error("v5 canónica: `now` inyectado inválido");
  const starts = Date.parse(String(r.starts_at));
  const due = Date.parse(String(r.due_date));
  if (!Number.isFinite(starts)) throw new Error("v5 canónica: starts_at no es un instante válido");
  if (!Number.isFinite(due)) throw new Error("v5 canónica: due_date no es un instante válido");
  if (due < starts) throw new Error("v5 canónica: due_date anterior a starts_at");
  if (due <= nowMs) throw new Error("v5 canónica: la tarea nacería vencida (due_date <= ahora)");

  const seg = key.split(":");
  const esperado = [
    ["rules_version", seg[1]], ["task_code", seg[2]], ["building_id", seg[3]],
    ["subject_id", seg[4]], ["trigger_fingerprint", seg[5]],
  ] as const;
  for (const [campo, valor] of esperado) {
    if (String(r[campo]) !== valor) {
      throw new Error(`v5 canónica: ${campo} no concuerda con la task_key`);
    }
  }
}

/** Inserta la tarea canónica del Motor tras validar el contrato completo. */
export async function insertV5CanonicalTask(
  client: ClientLike, input: unknown, opts: CanonicalWriteOpts = {},
) {
  const row = input;
  assertV5CanonicalTaskRow(row, opts);
  return await client.from("building_tasks").insert(row).select("id, task_key").maybeSingle();
}
