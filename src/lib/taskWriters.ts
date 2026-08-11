/**
 * ÚNICO escritor autorizado de `building_tasks` en el cliente.
 *
 * Solo existe una escritura de creación permitida desde la app: la tarea
 * MANUAL creada explícitamente por una persona. Cualquier tarea automática o
 * legacy queda prohibida por contrato (y por la guarda de arquitectura).
 */

export type ManualSubtype = "posible_interes" | "otro";

export type ManualTaskInput = {
  building_id: string;
  user_id: string;
  /** Autor real (auth.uid()). El contrato manual lo exige siempre. */
  created_by: string;
  subject_type: "owner" | "building";
  subject_id: string;
  manual_subtype: ManualSubtype;
  title: string;
  description?: string | null;
  priority: "low" | "medium" | "high";
  /** Ventana REAL: instantes ISO, nunca deducidos de la clave. */
  starts_at: string;
  due_date: string;
};

export type ManualTaskRow = Omit<ManualTaskInput, "description"> & {
  task_type: "manual";
  generation_mode: "manual";
  task_key: null;
  task_code: null;
  status: "pending";
  description: string | null;
};

/**
 * Construye y valida la fila manual CANÓNICA (P0.3). Rechaza payloads
 * auto/legacy y cualquier contrato incompleto: sin autor, sin subtipo, sin
 * sujeto o sin ventana temporal no hay tarea manual.
 */
export function buildManualTaskRow(input: unknown): ManualTaskRow {
  const i = (input ?? {}) as Record<string, unknown>;
  const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const instant = (v: unknown) => (nonEmpty(v) ? Date.parse(String(v)) : NaN);
  if (!nonEmpty(i.building_id)) throw new Error("tarea manual: building_id obligatorio");
  if (!nonEmpty(i.user_id)) throw new Error("tarea manual: user_id obligatorio");
  if (!nonEmpty(i.created_by)) throw new Error("tarea manual: created_by (autor) obligatorio");
  if (i.subject_type !== "owner" && i.subject_type !== "building") {
    throw new Error("tarea manual: subject_type debe ser owner o building");
  }
  if (!nonEmpty(i.subject_id)) throw new Error("tarea manual: subject_id obligatorio");
  if (i.manual_subtype !== "posible_interes" && i.manual_subtype !== "otro") {
    throw new Error("tarea manual: manual_subtype obligatorio (posible_interes u otro)");
  }
  if (!nonEmpty(i.title)) throw new Error("tarea manual: title obligatorio");
  if (!["low", "medium", "high"].includes(String(i.priority))) {
    throw new Error("tarea manual: priority inválida");
  }
  const start = instant(i.starts_at);
  const end = instant(i.due_date);
  if (!Number.isFinite(start)) throw new Error("tarea manual: starts_at obligatorio (instante ISO)");
  if (!Number.isFinite(end)) throw new Error("tarea manual: due_date obligatorio (instante ISO)");
  if (end < start) throw new Error("tarea manual: due_date no puede ser anterior a starts_at");
  if (i.task_type !== undefined && i.task_type !== "manual") {
    throw new Error("tarea manual: task_type solo puede ser 'manual'");
  }
  if (i.generation_mode !== undefined && i.generation_mode !== "manual") {
    throw new Error("tarea manual: generation_mode solo puede ser 'manual' (nunca legacy)");
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
    created_by: String(i.created_by).trim(),
    subject_type: i.subject_type,
    subject_id: String(i.subject_id).trim(),
    manual_subtype: i.manual_subtype,
    title: String(i.title).trim(),
    description: nonEmpty(i.description) ? String(i.description).trim() : null,
    priority: i.priority as ManualTaskRow["priority"],
    starts_at: new Date(start).toISOString(),
    due_date: new Date(end).toISOString(),
    task_type: "manual",
    generation_mode: "manual",
    task_key: null,
    task_code: null,
    status: "pending",
  };
}

type ClientLike = { from: (table: string) => any };

/** Inserta la tarea manual validada. Única escritura de creación en cliente. */
export async function insertManualBuildingTask(client: ClientLike, input: unknown) {
  const row = buildManualTaskRow(input);
  return await client.from("building_tasks").insert(row);
}
