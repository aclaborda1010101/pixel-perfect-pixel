/**
 * MOTOR V5 — FASE A. Revalidación PURA de tareas abiertas.
 *
 * Antes de devolver una tarea abierta se revalida su trigger contra el
 * contexto actual. Si el trigger ya no existe se marca superseded_reason y
 * la tarea NO se vuelve a proponer (la clave no depende del día).
 */

import { computeEligibility, evaluateOwner } from "./eligibility";
import type { V5BuildingContext, V5Candidate, V5OwnerContext, V5TaskCode } from "./model";

export type V5OpenTask = {
  taskKey: string;
  taskCode: V5TaskCode;
  subjectType: "owner" | "building";
  subjectId: string;
  buildingId: string;
  triggerFingerprint: string;
  variant?: string | null;
};

export type V5Revalidation = {
  task: V5OpenTask;
  stillValid: boolean;
  supersededReason: string | null;
  currentCandidate: V5Candidate | null;
};

function supersedeReasonFor(task: V5OpenTask, ctx: { owner?: V5OwnerContext; building?: V5BuildingContext }): string {
  switch (task.taskCode) {
    case "T1":
      return ctx.owner?.hasValidPhone ? "t1_telefono_ya_disponible" : "trigger_inexistente";
    case "T4":
      return ctx.owner?.lastSignal?.kind === "interesado"
        ? "t4_nueva_senal_interesado"
        : "trigger_inexistente";
    case "T2_T3":
      return ctx.owner?.whatsapp?.sent || (ctx.owner?.callCount ?? 0) > 0
        ? "t2_t3_envio_realizado"
        : "trigger_inexistente";
    case "T6":
      return "t6_incidencia_resuelta";
    case "T8":
      return "t8_senal_superada";
    case "T9":
      return "t9_novedad_o_accion_personal";
    case "T5":
      return "t5_perfil_completado";
    default:
      return "trigger_inexistente";
  }
}

export function revalidateOpenTasks(
  building: V5BuildingContext,
  openTasks: readonly V5OpenTask[],
  opts: { now?: Date } = {},
): { valid: V5Revalidation[]; superseded: V5Revalidation[] } {
  const { candidates } = computeEligibility(building, opts);
  const byKey = new Map(candidates.map((c) => [c.taskKey, c]));
  const valid: V5Revalidation[] = [];
  const superseded: V5Revalidation[] = [];

  for (const task of openTasks) {
    const current = byKey.get(task.taskKey) ?? null;
    if (current && current.triggerFingerprint === task.triggerFingerprint) {
      valid.push({ task, stillValid: true, supersededReason: null, currentCandidate: current });
      continue;
    }
    const owner = building.owners.find((o) => o.ownerId === task.subjectId);
    superseded.push({
      task,
      stillValid: false,
      supersededReason: supersedeReasonFor(task, { owner, building }),
      currentCandidate: owner ? evaluateOwner(owner, opts).candidate : null,
    });
  }
  return { valid, superseded };
}