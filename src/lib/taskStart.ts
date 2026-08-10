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
  if (!task) return false;
  return task.status === "pending" && !task.started_at;
}
