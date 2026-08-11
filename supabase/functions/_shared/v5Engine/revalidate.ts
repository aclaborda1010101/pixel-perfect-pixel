/**
 * MOTOR V5 — P0.2. Revalidación, tombstones y dedupe.
 *
 * Entrada: TODAS las tareas V5 existentes del edificio (abiertas, blocked y
 * terminales). Salida: valid | update-in-place | supersede(+replacement) |
 * suppress. Un fingerprint terminal deja TOMBSTONE y no reaparece; sólo
 * vuelve con una instancia de disparador nueva y trazable.
 *
 * `blocked` participa en el dedupe (consume su task_key/fingerprint) pero
 * NO ocupa slot automático (ver status.ts).
 */

import { computeEligibility } from "./eligibility.ts";
import type { V5BuildingContext, V5Candidate, V5TaskCode } from "./model.ts";
import {
  isTerminalStatus,
  isV5TaskStatus,
  type V5TaskStatus,
} from "./status.ts";

/** Tarea V5 existente, en cualquier estado canónico. */
export type V5ExistingTask = {
  taskKey: string;
  taskCode: V5TaskCode;
  subjectType: "owner" | "building";
  subjectId: string;
  buildingId: string;
  triggerFingerprint: string;
  status: V5TaskStatus;
  resolvedAt?: string | null;
  cooldownUntil?: string | null;
};

/** Compat: forma histórica sin estado (se asume abierta `pending`). */
export type V5OpenTask = Omit<V5ExistingTask, "status"> & { status?: V5TaskStatus };

/** Resultados terminales canónicos: `discarded` YA NO existe. */
export const V5_TOMBSTONE_STATUSES = [
  "completed",
  "skipped",
  "no_procede",
  "cancelled",
] as const;

export type V5TerminalOutcome = (typeof V5_TOMBSTONE_STATUSES)[number] | "superseded";

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
  valid: { task: V5ExistingTask; candidate: V5Candidate }[];
  updated: { task: V5ExistingTask; candidate: V5Candidate; changeReason: string }[];
  superseded: { task: V5ExistingTask; supersededReason: string; replacement: V5Candidate | null }[];
  suppressed: { candidate: V5Candidate; reason: string }[];
  fresh: V5Candidate[];
  /** Tareas terminales/blocked que sólo aportan dedupe. */
  dedupeOnly: { task: V5ExistingTask; role: "blocked" | "tombstone" }[];
};

export function supersedeReasonFor(task: { taskCode: V5TaskCode; subjectId: string }, building: V5BuildingContext): string {
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

function normalizeTask(t: V5OpenTask | V5ExistingTask): V5ExistingTask {
  const status = isV5TaskStatus(t.status) ? t.status : "pending";
  return { ...t, status } as V5ExistingTask;
}

/**
 * Revalida TODAS las tareas V5 del edificio.
 *
 * - `pending`/`in_progress`: se revalidan (valid/update/supersede).
 * - `blocked`: permanece visible; consume task_key + fingerprint para el
 *   dedupe pero no se supersede ni ocupa slot.
 * - terminales: dejan tombstone del fingerprint. `superseded` NO deja
 *   tombstone permanente: admite sustitución si el trigger cambia de verdad.
 */
export function revalidateOpenTasks(
  building: V5BuildingContext,
  tasks: readonly (V5OpenTask | V5ExistingTask)[],
  opts: { now?: Date; history?: readonly V5TerminalRecord[] } = {},
): V5RevalidationResult {
  const now = opts.now ?? new Date();
  const history = opts.history ?? [];
  const { candidates } = computeEligibility(building, { now });

  const all = tasks.map(normalizeTask);
  const revalidatable = all.filter((t) => t.status === "pending" || t.status === "in_progress");
  const blocked = all.filter((t) => t.status === "blocked");
  const terminal = all.filter((t) => isTerminalStatus(t.status));

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
  const out: V5RevalidationResult = {
    valid: [], updated: [], superseded: [], suppressed: [], fresh: [], dedupeOnly: [],
  };

  // blocked: se conserva y consume su clave (no reaparece como fresh).
  for (const t of blocked) {
    consumed.add(t.taskKey);
    out.dedupeOnly.push({ task: t, role: "blocked" });
  }

  for (const task of revalidatable) {
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

  // Tombstones: terminales reales del edificio + historial recibido.
  const tombstones = new Set<string>();
  for (const t of terminal) {
    out.dedupeOnly.push({ task: t, role: "tombstone" });
    // `superseded` sólo tapa la clave exacta: si el trigger cambia de verdad
    // (fingerprint distinto) se admite sustitución.
    if (t.status !== "superseded") tombstones.add(t.triggerFingerprint);
    consumed.add(t.taskKey);
  }
  for (const h of history) {
    if ((V5_TOMBSTONE_STATUSES as readonly string[]).includes(h.outcome)) {
      tombstones.add(h.triggerFingerprint);
    }
  }

  const cooldowns = new Map<string, string>();
  for (const h of [...history, ...terminal.map((t) => ({
    subjectId: t.subjectId, taskCode: t.taskCode, cooldownUntil: t.cooldownUntil ?? null,
  }))]) {
    if (!h.cooldownUntil) continue;
    const until = Date.parse(h.cooldownUntil);
    if (Number.isFinite(until) && until > now.getTime()) cooldowns.set(key(h.subjectId, h.taskCode), h.cooldownUntil);
  }

  for (const c of candidates) {
    if (consumed.has(c.taskKey)) continue;
    if (tombstones.has(c.triggerFingerprint)) {
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
