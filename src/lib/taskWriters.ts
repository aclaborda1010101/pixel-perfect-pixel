/**
 * ÚNICO escritor autorizado de `building_tasks` en el cliente.
 *
 * Solo existe una escritura de creación permitida desde la app: la tarea
 * MANUAL creada explícitamente por una persona. Cualquier tarea automática o
 * legacy queda prohibida por contrato (y por la guarda de arquitectura).
 */

export type ManualTaskInput = {
  building_id: string;
  user_id: string;
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high";
  due_date?: string | null;
};

export type ManualTaskRow = ManualTaskInput & {
  task_type: "manual";
  task_key: null;
  status: "pending";
  description: string | null;
  due_date: string | null;
};

/** Construye y valida la fila manual. Rechaza payloads auto/legacy. */
export function buildManualTaskRow(input: unknown): ManualTaskRow {
  const i = (input ?? {}) as Record<string, unknown>;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (!nonEmpty(i.building_id)) throw new Error("tarea manual: building_id obligatorio");
  if (!nonEmpty(i.user_id)) throw new Error("tarea manual: user_id obligatorio");
  if (!nonEmpty(i.title)) throw new Error("tarea manual: title obligatorio");
  if (!["low", "medium", "high"].includes(String(i.priority))) {
    throw new Error("tarea manual: priority inválida");
  }
  if (i.task_type !== undefined && i.task_type !== "manual") {
    throw new Error("tarea manual: task_type solo puede ser 'manual'");
  }
  if (i.task_key !== undefined && i.task_key !== null) {
    throw new Error("tarea manual: una tarea manual nunca lleva task_key");
  }
  if (i.status !== undefined && i.status !== "pending") {
    throw new Error("tarea manual: status inicial debe ser pending");
  }
  return {
    building_id: String(i.building_id).trim(),
    user_id: String(i.user_id).trim(),
    title: String(i.title).trim(),
    description: nonEmpty(i.description) ? String(i.description).trim() : null,
    priority: i.priority as ManualTaskRow["priority"],
    due_date: nonEmpty(i.due_date) ? String(i.due_date) : null,
    task_type: "manual",
    task_key: null,
    status: "pending",
  };
}

type ClientLike = { from: (table: string) => any };

/** Inserta la tarea manual validada. Única escritura de creación en cliente. */
export async function insertManualBuildingTask(client: ClientLike, input: unknown) {
  const row = buildManualTaskRow(input);
  return await client.from("building_tasks").insert(row);
}
