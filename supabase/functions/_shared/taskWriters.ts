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

export type V5CallQueueTaskRow = {
  building_id: string;
  user_id: string;
  task_type: "call_queue";
  task_key: string;
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high";
  status: "pending";
  due_date: string;
};

export function assertV5CallQueueRow(row: unknown): asserts row is V5CallQueueTaskRow {
  const r = (row ?? {}) as Record<string, unknown>;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!nonEmpty(r.building_id)) throw new Error("v5 task: building_id obligatorio");
  if (!nonEmpty(r.user_id)) throw new Error("v5 task: user_id obligatorio");
  if (r.task_type !== "call_queue") throw new Error("v5 task: task_type debe ser call_queue");
  if (!nonEmpty(r.task_key) || !V5_TASK_KEY_RX.test(String(r.task_key))) {
    throw new Error(`v5 task: task_key inválida (${String(r.task_key)})`);
  }
  if (!nonEmpty(r.title)) throw new Error("v5 task: title obligatorio");
  if (!["low", "medium", "high"].includes(String(r.priority))) {
    throw new Error("v5 task: priority inválida");
  }
  if (r.status !== "pending") throw new Error("v5 task: status inicial debe ser pending");
  if (!nonEmpty(r.due_date)) throw new Error("v5 task: due_date obligatorio");
}

type ClientLike = { from: (table: string) => any };

/** Inserta una tarea de la cola V5 tras validar el contrato completo. */
export async function insertV5CallQueueTask(client: ClientLike, input: unknown) {
  const row = input;
  assertV5CallQueueRow(row);
  return await client.from("building_tasks").insert(row).select("id, task_key").maybeSingle();
}

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

export function assertV5CanonicalTaskRow(row: unknown): asserts row is V5CanonicalTaskRow {
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
export async function insertV5CanonicalTask(client: ClientLike, input: unknown) {
  const row = input;
  assertV5CanonicalTaskRow(row);
  return await client.from("building_tasks").insert(row).select("id, task_key").maybeSingle();
}
