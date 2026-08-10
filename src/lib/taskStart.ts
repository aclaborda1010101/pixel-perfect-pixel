import { supabase } from "@/integrations/supabase/client";

/**
 * Marca el INICIO REAL de una tarea.
 * - pending -> in_progress
 * - started_at sólo se fija si estaba a NULL (idempotente)
 * - el servidor rechaza tareas de otro comercial
 */
export async function startBuildingTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await (supabase.rpc as any)("start_building_task", { p_task_id: taskId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function canStartTask(task: { status?: string | null; started_at?: string | null } | null | undefined): boolean {
  return decideTaskStart(task).action === "start";
}

export type TaskStartDecision =
  | { action: "start"; reason: "pending" }
  | { action: "noop_ok"; reason: "ya_iniciada" }
  | { action: "reject"; reason: "estado_no_iniciable" };

/**
 * Decisión pura equivalente a la del RPC start_building_task.
 * - pending                    -> se inicia (fija started_at si estaba a NULL)
 * - in_progress con started_at -> éxito idempotente, sin escritura
 * - resto de estados           -> rechazo explícito (no se falsea éxito)
 */
export function decideTaskStart(
  task: { status?: string | null; started_at?: string | null } | null | undefined,
): TaskStartDecision {
  const status = task?.status ?? null;
  if (status === "pending") return { action: "start", reason: "pending" };
  if (status === "in_progress" && task?.started_at) {
    return { action: "noop_ok", reason: "ya_iniciada" };
  }
  return { action: "reject", reason: "estado_no_iniciable" };
}

/** Reapertura: volver a pending limpia started_at para no arrastrar duraciones falsas. */
export function reopenPatch(): { status: "pending"; started_at: null; completed_at: null } {
  return { status: "pending", started_at: null, completed_at: null };
}
