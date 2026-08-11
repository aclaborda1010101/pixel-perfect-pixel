/**
 * MOTOR V5 — FASE A.1. Manual y demo PUROS (cero escrituras).
 */

import { computeEligibility } from "./eligibility";
import { selectNextByMode, V5_WINDOW_SIZE, type V5ModeConfig, type V5WindowEntry } from "./modes";
import type { V5BuildingContext, V5Candidate, V5ManualSubtype } from "./model";
import { V5_RULES_VERSION } from "./model";

export type V5ManualDraft = {
  buildingId: string;
  subjectType: "owner" | "building";
  subjectId: string;
  title: string;
  manualSubtype: V5ManualSubtype;
  /** Instante exacto (timestamptz), no fecha. */
  startsAt: string;
  dueDate: string;
  createdBy: string;
};

export type V5ManualValidation = {
  valid: boolean;
  errors: string[];
  draft:
    | (V5ManualDraft & { generationMode: "manual"; rulesVersion: string; taskType: "manual" })
    | null;
};

export const V5_MANUAL_SUBTYPES: readonly V5ManualSubtype[] = ["posible_interes", "otro"];

export function validateManualDraft(draft: Partial<V5ManualDraft>): V5ManualValidation {
  const errors: string[] = [];
  if (!draft.buildingId) errors.push("Falta edificio.");
  if (draft.subjectType !== "owner" && draft.subjectType !== "building") {
    errors.push(`Tipo de sujeto no admitido: ${String(draft.subjectType)}`);
  }
  if (!draft.subjectId) errors.push("Falta sujeto.");
  if (!draft.createdBy) errors.push("Falta el autor (created_by).");
  if (!draft.title || !draft.title.trim()) errors.push("Falta título.");
  if (!draft.manualSubtype || !V5_MANUAL_SUBTYPES.includes(draft.manualSubtype)) {
    errors.push(`Subtipo manual no admitido: ${String(draft.manualSubtype)}`);
  }
  const start = draft.startsAt ? Date.parse(draft.startsAt) : NaN;
  const end = draft.dueDate ? Date.parse(draft.dueDate) : NaN;
  if (!Number.isFinite(start)) errors.push("Fecha de inicio inválida.");
  if (!Number.isFinite(end)) errors.push("Fecha de fin inválida.");
  if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
    errors.push("La fecha de fin no puede ser anterior a la de inicio.");
  }
  if (errors.length > 0) return { valid: false, errors, draft: null };
  return {
    valid: true,
    errors: [],
    draft: {
      ...(draft as V5ManualDraft),
      taskType: "manual",
      generationMode: "manual",
      rulesVersion: V5_RULES_VERSION,
    },
  };
}

export type V5RecomputeTask = { taskKey: string; generationMode?: string | null };

/** Las manuales (y el legado) NUNCA se borran en un recompute. */
export function isProtectedFromRecompute(task: { generationMode?: string | null }): boolean {
  return task.generationMode === "manual" || task.generationMode === "legacy";
}

/** Lógica realmente usada por el recompute: qué se puede retirar y qué no. */
export function planRecomputeDeletions<T extends V5RecomputeTask>(
  tasks: readonly T[],
): { deletable: T[]; protectedTasks: T[] } {
  const deletable: T[] = [];
  const protectedTasks: T[] = [];
  for (const t of tasks) (isProtectedFromRecompute(t) ? protectedTasks : deletable).push(t);
  return { deletable, protectedTasks };
}

export type V5DemoResult = {
  comercialId: string | null;
  requested: number;
  proposals: V5Candidate[];
  shortfall: number;
  report: string;
  reasons: string[];
  writes: 0;
};

export const V5_DEMO_LIMIT = 20;

/**
 * Demo: hasta 20 propuestas, obtenidas iterando selectNextByMode con historia
 * VIRTUAL (ventana móvil de 20). Mismas reglas, mismo modo, CERO escrituras.
 */
export function buildDemoProposals(input: {
  comercialId: string | null;
  buildings: readonly V5BuildingContext[];
  config: V5ModeConfig;
  window?: readonly V5WindowEntry[];
  now?: Date;
  limit?: number;
}): V5DemoResult {
  const limit = Math.min(input.limit ?? V5_DEMO_LIMIT, V5_DEMO_LIMIT);
  const reasons: string[] = [];
  const candidates: V5Candidate[] = [];
  for (const b of input.buildings) {
    const res = computeEligibility(b, { now: input.now });
    candidates.push(...res.candidates);
  }

  const proposals: V5Candidate[] = [];
  let virtualWindow: V5WindowEntry[] = (input.window ?? []).slice(0, V5_WINDOW_SIZE);
  const used = new Set<string>();

  for (let i = 0; i < limit; i++) {
    const step = selectNextByMode({
      comercialId: input.comercialId,
      candidates: candidates.filter((c) => !used.has(c.taskKey)),
      config: input.config,
      window: virtualWindow,
      now: input.now,
    });
    if (!step.selected) {
      reasons.push(...step.reasons);
      break;
    }
    used.add(step.selected.taskKey);
    virtualWindow = step.window;
    proposals.push({
      ...step.selected,
      eligibilitySnapshot: { ...step.selected.eligibilitySnapshot, generation_mode: "demo" },
    });
  }

  const shortfall = Math.max(0, limit - proposals.length);
  const report = `${proposals.length}/${limit}`;
  if (shortfall > 0) reasons.unshift(`Sólo ${report} propuestas disponibles.`);
  return {
    comercialId: input.comercialId,
    requested: limit,
    proposals: proposals.slice(0, V5_DEMO_LIMIT),
    shortfall,
    report,
    reasons: [...new Set(reasons)],
    writes: 0,
  };
}
