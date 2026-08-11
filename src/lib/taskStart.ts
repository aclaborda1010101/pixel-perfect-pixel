import { supabase } from "@/integrations/supabase/client";
import {
  V5_REOPENABLE_STATUSES,
  isV5TaskStatus,
  occupiesAutomaticSlot,
} from "@/lib/v5/status";
import { V5_STARTABLE_GENERATION_MODES } from "@/lib/v5/model";

/** Estados terminales/bloqueados desde los que SÍ se admite reapertura. */
export const REOPENABLE_STATUSES = V5_REOPENABLE_STATUSES;
/**
 * Modos de generación con tareas REALES e iniciables.
 * Las manuales son tareas reales: sí pueden iniciarse. legacy/demo no.
 */
export const STARTABLE_GENERATION_MODES = V5_STARTABLE_GENERATION_MODES;

export { occupiesAutomaticSlot };

export type TaskLike = {
  status?: string | null;
  started_at?: string | null;
  generation_mode?: string | null;
};

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

/**
 * ÚNICA vía de reapertura. Ninguna pantalla puede escribir building_tasks
 * directamente para reabrir: el RPC valida estado, propiedad y limpia el ciclo.
 */
export async function reopenBuildingTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await (supabase.rpc as any)("reopen_building_task", { p_task_id: taskId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export function canStartTask(task: TaskLike | null | undefined): boolean {
  return decideTaskStart(task).action === "start";
}

export function canReopenTask(task: TaskLike | null | undefined): boolean {
  return decideTaskReopen(task).action === "reopen";
}

export type TaskStartDecision =
  | { action: "start"; reason: "pending" }
  | { action: "noop_ok"; reason: "ya_iniciada" }
  | {
      action: "reject";
      reason: "estado_no_iniciable" | "estado_no_canonico" | "modo_no_iniciable" | "requiere_reapertura";
    };

export type TaskReopenDecision =
  | { action: "reopen"; reason: "estado_terminal" }
  | { action: "reject"; reason: "estado_no_reabrible" | "estado_no_canonico" };

/**
 * Decisión pura equivalente a la del RPC start_building_task.
 * - pending                    -> se inicia (fija started_at si estaba a NULL)
 * - in_progress con started_at -> éxito idempotente, sin escritura
 * - resto de estados           -> rechazo explícito (no se falsea éxito)
 */
export function decideTaskStart(task: TaskLike | null | undefined): TaskStartDecision {
  const status = task?.status ?? null;
  const mode = task?.generation_mode ?? "production";
  if (!(STARTABLE_GENERATION_MODES as readonly string[]).includes(mode)) {
    return { action: "reject", reason: "modo_no_iniciable" };
  }
  // Un typo o un 'queued' NO puede colarse como pendiente.
  if (!isV5TaskStatus(status)) return { action: "reject", reason: "estado_no_canonico" };
  if (status === "pending") return { action: "start", reason: "pending" };
  if (status === "in_progress") {
    // Histórico sin started_at: NO se inventa duración; exige reapertura.
    return task?.started_at
      ? { action: "noop_ok", reason: "ya_iniciada" }
      : { action: "reject", reason: "requiere_reapertura" };
  }
  return { action: "reject", reason: "estado_no_iniciable" };
}

/** Reapertura SÓLO desde estados terminales o bloqueados. */
export function decideTaskReopen(task: TaskLike | null | undefined): TaskReopenDecision {
  const status = task?.status ?? null;
  if (!isV5TaskStatus(status)) return { action: "reject", reason: "estado_no_canonico" };
  if ((REOPENABLE_STATUSES as readonly string[]).includes(status)) {
    return { action: "reopen", reason: "estado_terminal" };
  }
  return { action: "reject", reason: "estado_no_reabrible" };
}
