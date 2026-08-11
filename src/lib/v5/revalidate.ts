/**
 * MOTOR V5 — FASE A.1. Revalidación y tombstones PUROS.
 *
 * Entrada: tareas abiertas + historial terminal/superseded + cooldowns.
 * Salida: valid | update-in-place | supersede(+replacement) | suppress.
 * Un fingerprint ya resuelto NO reaparece al día siguiente; sólo vuelve con
 * una instancia de disparador (trigger_instance/event_id) nueva y trazable.
 */

import { computeEligibility } from "./eligibility";
import type { V5BuildingContext, V5Candidate, V5TaskCode } from "./model";

export type V5OpenTask = {
  taskKey: string;
  taskCode: V5TaskCode;
  subjectType: "owner" | "building";
  subjectId: string;
  buildingId: string;
  triggerFingerprint: string;
};

export type V5TerminalOutcome = "completed" | "discarded" | "superseded";

export type V5TerminalRecord = {
  taskKey: string;
  taskCode: V5TaskCode;
  subjectId: string;
  triggerFingerprint: string;
  outcome: V5TerminalOutcome;
  resolvedAt: string;
  cooldownUntil?: string | null;
};

export type V5RevalidationResult = {
  valid: { task: V5OpenTask; candidate: V5Candidate }[];
  updated: { task: V5OpenTask; candidate: V5Candidate; changeReason: string }[];
  superseded: { task: V5OpenTask; supersededReason: string; replacement: V5Candidate | null }[];
  suppressed: { candidate: V5Candidate; reason: string }[];
  fresh: V5Candidate[];
};

export function supersedeReasonFor(task: V5OpenTask, building: V5BuildingContext): string {
  const owner = building.owners.find((o) => o.ownerId === task.subjectId);
  switch (task.taskCode) {
    case "T1":
      return owner?.hasValidPhone ? "t1_canal_ya_disponible" : "trigger_inexistente";
    case "T4":
      return owner?.lastSignal?.kind === "interesado" ? "t4_nueva_senal_interesado" : "trigger_inexistente";
    case "T2_T3":
      return owner?.whatsapp?.sent === true || (owner?.callCount ?? 0) > 0
        ? "t2_t3_acciones_resueltas"
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

const key = (subjectId: string, code: string) => `${subjectId}|${code}`;

export function revalidateOpenTasks(
  building: V5BuildingContext,
  openTasks: readonly V5OpenTask[],
  opts: { now?: Date; history?: readonly V5TerminalRecord[] } = {},
): V5RevalidationResult {
  const now = opts.now ?? new Date();
  const history = opts.history ?? [];
  const { candidates } = computeEligibility(building, { now });

  const byKey = new Map(candidates.map((c) => [c.taskKey, c]));
  const bySubjectCode = new Map<string, V5Candidate>();
  const bySubject = new Map<string, V5Candidate[]>();
  for (const c of candidates) {
    const k = key(c.subjectId, c.taskCode);
    if (!bySubjectCode.has(k)) bySubjectCode.set(k, c);
    const list = bySubject.get(c.subjectId) ?? [];
    list.push(c);
    bySubject.set(c.subjectId, list);
  }

  const consumed = new Set<string>();
  const out: V5RevalidationResult = { valid: [], updated: [], superseded: [], suppressed: [], fresh: [] };

  for (const task of openTasks) {
    const exact = byKey.get(task.taskKey);
    if (exact && exact.triggerFingerprint === task.triggerFingerprint) {
      consumed.add(exact.taskKey);
      out.valid.push({ task, candidate: exact });
      continue;
    }
    const sameCode = bySubjectCode.get(key(task.subjectId, task.taskCode));
    if (sameCode && !consumed.has(sameCode.taskKey)) {
      consumed.add(sameCode.taskKey);
      out.updated.push({
        task,
        candidate: sameCode,
        changeReason: `El disparador sigue vivo con contenido distinto (${task.taskCode}): se actualiza en sitio, no se marca resuelto.`,
      });
      continue;
    }
    const replacement = (bySubject.get(task.subjectId) ?? []).find((c) => !consumed.has(c.taskKey)) ?? null;
    if (replacement) consumed.add(replacement.taskKey);
    out.superseded.push({ task, supersededReason: supersedeReasonFor(task, building), replacement });
  }

  const resolvedFingerprints = new Set(
    history.filter((h) => h.outcome === "completed" || h.outcome === "discarded").map((h) => h.triggerFingerprint),
  );
  const cooldowns = new Map<string, string>();
  for (const h of history) {
    if (!h.cooldownUntil) continue;
    const until = Date.parse(h.cooldownUntil);
    if (Number.isFinite(until) && until > now.getTime()) cooldowns.set(key(h.subjectId, h.taskCode), h.cooldownUntil);
  }

  for (const c of candidates) {
    if (consumed.has(c.taskKey)) continue;
    if (resolvedFingerprints.has(c.triggerFingerprint)) {
      out.suppressed.push({ candidate: c, reason: "fingerprint_ya_resuelto" });
      continue;
    }
    const cd = cooldowns.get(key(c.subjectId, c.taskCode));
    if (cd) {
      out.suppressed.push({ candidate: c, reason: `cooldown_activo_hasta_${cd}` });
      continue;
    }
    out.fresh.push(c);
  }

  return out;
}
