/**
 * MOTOR V5 — FASE A. Manual y demo PUROS (sin escrituras productivas).
 */

import { computeEligibility } from "./eligibility";
import { selectByMode, type V5ModeConfig } from "./modes";
import type { V5BuildingContext, V5Candidate, V5ManualSubtype } from "./model";
import { V5_RULES_VERSION } from "./model";

export type V5ManualDraft = {
  buildingId: string;
  subjectType: "owner" | "building";
  subjectId: string;
  title: string;
  manualSubtype: V5ManualSubtype;
  startsAt: string;
  dueDate: string;
  createdBy: string;
};

export type V5ManualValidation =
  | { valid: true; draft: V5ManualDraft & { generationMode: "manual"; rulesVersion: string; taskType: "manual" } }
  | { valid: false; errors: string[] };

export const V5_MANUAL_SUBTYPES: readonly V5ManualSubtype[] = ["posible_interes", "otro"];

export function validateManualDraft(draft: Partial<V5ManualDraft>): V5ManualValidation {
  const errors: string[] = [];
  if (!draft.buildingId) errors.push("Falta edificio.");
  if (!draft.subjectId) errors.push("Falta sujeto.");
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
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    draft: {
      ...(draft as V5ManualDraft),
      taskType: "manual",
      generationMode: "manual",
      rulesVersion: V5_RULES_VERSION,
    },
  };
}

/** Las manuales NUNCA se borran en un recompute. */
export function isProtectedFromRecompute(task: { generationMode?: string | null }): boolean {
  return task.generationMode === "manual";
}

export type V5DemoResult = {
  comercialId: string | null;
  requested: number;
  proposals: V5Candidate[];
  shortfall: number;
  reasons: string[];
  writes: 0;
};

export const V5_DEMO_LIMIT = 20;

/** Demo: hasta 20 propuestas por comercial, mismas reglas y modo, CERO escrituras. */
export function buildDemoProposals(input: {
  comercialId: string | null;
  buildings: readonly V5BuildingContext[];
  config: V5ModeConfig;
  recentProductionBuckets?: readonly string[];
  now?: Date;
  limit?: number;
}): V5DemoResult {
  const limit = input.limit ?? V5_DEMO_LIMIT;
  const candidates: V5Candidate[] = [];
  const reasons: string[] = [];
  for (const b of input.buildings) {
    const res = computeEligibility(b, { now: input.now });
    candidates.push(...res.candidates);
    for (const n of res.notes) if (!n.reason.startsWith("T")) reasons.push(`${n.subjectId}: ${n.reason}`);
  }
  const sel = selectByMode({
    comercialId: input.comercialId,
    candidates,
    config: input.config,
    recentProductionBuckets: input.recentProductionBuckets,
    limit,
  });
  const proposals = sel.selected.map((c) => ({
    ...c,
    eligibilitySnapshot: { ...c.eligibilitySnapshot, generation_mode: "demo" },
  }));
  const shortfall = Math.max(0, limit - proposals.length);
  if (shortfall > 0) reasons.unshift(`Sólo ${proposals.length}/${limit} propuestas disponibles.`);
  reasons.push(...sel.reasons);
  return { comercialId: input.comercialId, requested: limit, proposals, shortfall, reasons, writes: 0 };
}