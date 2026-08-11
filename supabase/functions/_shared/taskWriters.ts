/**
 * ÚNICO escritor autorizado de `building_tasks` en el lado servidor.
 *
 * Contención legacy: ninguna función edge puede hacer `.insert()` directo
 * sobre `building_tasks`. La cola diaria V5 (assign_daily_call_queue) pasa
 * por aquí, y aquí se valida el contrato de la fila antes de escribir.
 */

/** Clave V5 productiva: `v5:<YYYY-MM-DD>:<code>:<id>`. */
export const V5_TASK_KEY_RX =
  /^v5:\d{4}-\d{2}-\d{2}:(T-0[1-9]|T[1-9](?:_T[1-9])?):[A-Za-z0-9_.:-]+$/;

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
