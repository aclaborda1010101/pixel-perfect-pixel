/**
 * MOTOR V5 — FASE A. Modos PUROS (no conectados al motor real).
 *
 * Los modos SOLO seleccionan entre candidatos ya elegibles: nunca crean
 * candidatos ni relajan reglas. T7 se rechaza siempre.
 */

import type { V5Candidate, V5TaskCode } from "./model";
import { V5_TASK_CODES } from "./model";

export type V5Bucket = V5TaskCode;
export const V5_BUCKETS: readonly V5Bucket[] = V5_TASK_CODES;

export type V5ModeCode = "iniciar_conversaciones" | "equilibrado" | "seguimiento" | "manual";
export type V5Mix = Partial<Record<string, number>>;

export const V5_MODE_TEMPLATES: Record<Exclude<V5ModeCode, "manual">, Record<V5Bucket, number>> = {
  iniciar_conversaciones: { T1: 15, T2_T3: 45, T4: 10, T5: 10, T6: 10, T8: 10, T9: 0 },
  equilibrado: { T1: 10, T2_T3: 25, T4: 20, T5: 15, T6: 15, T8: 10, T9: 5 },
  seguimiento: { T1: 5, T2_T3: 10, T4: 35, T5: 20, T6: 15, T8: 10, T9: 5 },
};

export type V5MixValidation = { valid: boolean; total: number; errors: string[] };

export function validateMix(mix: V5Mix | null | undefined): V5MixValidation {
  const errors: string[] = [];
  if (!mix || typeof mix !== "object") return { valid: false, total: 0, errors: ["No hay mezcla definida."] };
  let total = 0;
  for (const [code, raw] of Object.entries(mix)) {
    if (code === "T7") {
      errors.push("T7 está excluida del motor V5.");
      continue;
    }
    if (!(V5_BUCKETS as readonly string[]).includes(code)) {
      errors.push(`Bucket desconocido: ${code}`);
      continue;
    }
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > 100) {
      errors.push(`Peso inválido en ${code}: ${String(raw)}`);
      continue;
    }
    total += v;
  }
  if (total !== 100) errors.push(`La suma debe ser exactamente 100 (actual: ${total}).`);
  return { valid: errors.length === 0, total, errors };
}

export type V5ModeConfig = {
  /** Modo global de la organización. */
  global: { mode: V5ModeCode; mix?: V5Mix | null };
  /** Override por comercial: gana al global. */
  overrides?: Record<string, { mode: V5ModeCode; mix?: V5Mix | null }> | null;
};

export function resolveModeFor(
  comercialId: string | null | undefined,
  config: V5ModeConfig,
): { mode: V5ModeCode; mix: V5Mix | null; source: "override" | "global" } {
  const ov = comercialId ? config.overrides?.[comercialId] : undefined;
  const chosen = ov ?? config.global;
  const source: "override" | "global" = ov ? "override" : "global";
  const mix =
    chosen.mode === "manual"
      ? null
      : chosen.mix ?? V5_MODE_TEMPLATES[chosen.mode as Exclude<V5ModeCode, "manual">];
  return { mode: chosen.mode, mix: mix ?? null, source };
}

export type V5SelectionInput = {
  comercialId: string | null;
  candidates: readonly V5Candidate[];
  config: V5ModeConfig;
  /** Buckets de las últimas 20 tareas production (más recientes primero). */
  recentProductionBuckets?: readonly string[];
  limit: number;
};

export type V5Selection = {
  selected: V5Candidate[];
  modeSnapshot: Record<string, unknown>;
  deficitReport: Record<string, number>;
  reasons: string[];
};

function bucketCounts(source: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of V5_BUCKETS) out[b] = 0;
  for (const b of source) if (b in out) out[b] += 1;
  return out;
}

/** Prioriza urgencias: T8 urgente, T6 bloqueante, manual urgente. */
function isPriority(c: V5Candidate): boolean {
  return (c.taskCode === "T8" && !!c.urgent) || (c.taskCode === "T6" && !!c.blocking);
}

/**
 * Selección ponderada DETERMINISTA por déficit sobre las últimas 20 production.
 * Si un bucket no tiene elegibles, continúa con los demás sin inventar nada.
 */
export function selectByMode(input: V5SelectionInput): V5Selection {
  const reasons: string[] = [];
  const resolved = resolveModeFor(input.comercialId, input.config);
  const history = (input.recentProductionBuckets ?? []).slice(0, 20);
  const counts = bucketCounts(history);

  if (resolved.mode === "manual") {
    return {
      selected: [],
      modeSnapshot: {
        mode: "manual",
        source: resolved.source,
        comercial_id: input.comercialId,
        automaticas: 0,
        motivo: "Modo manual: cero tareas automáticas.",
      },
      deficitReport: {},
      reasons: ["Modo manual: no se generan automáticas."],
    };
  }

  const validation = validateMix(resolved.mix);
  if (!validation.valid) {
    return {
      selected: [],
      modeSnapshot: {
        mode: resolved.mode,
        source: resolved.source,
        invalid_mix: true,
        errors: validation.errors,
      },
      deficitReport: {},
      reasons: validation.errors,
    };
  }
  const mix = resolved.mix as Record<string, number>;

  const pool = new Map<string, V5Candidate[]>();
  for (const b of V5_BUCKETS) pool.set(b, []);
  for (const c of input.candidates) {
    if (!pool.has(c.taskCode)) continue;
    pool.get(c.taskCode)!.push(c);
  }
  // Orden estable dentro de cada bucket.
  for (const [, list] of pool) list.sort((a, b) => (a.taskKey < b.taskKey ? -1 : a.taskKey > b.taskKey ? 1 : 0));

  const selected: V5Candidate[] = [];
  const priorityJustifications: Record<string, string>[] = [];

  // 1) Urgencias que ganan al reparto, justificadas en el snapshot.
  for (const b of V5_BUCKETS) {
    const list = pool.get(b)!;
    for (let i = list.length - 1; i >= 0; i--) {
      if (selected.length >= input.limit) break;
      if (isPriority(list[i])) {
        const [c] = list.splice(i, 1);
        selected.push(c);
        counts[c.taskCode] += 1;
        priorityJustifications.push({
          task_key: c.taskKey,
          bucket: c.taskCode,
          motivo: c.taskCode === "T8" ? "T8 urgente: gana al reparto." : "T6 bloqueante: gana al reparto.",
        });
      }
    }
  }

  // 2) Reparto por mayor déficit respecto a la cuota teórica del histórico + selección.
  const emptyBuckets: string[] = [];
  while (selected.length < input.limit) {
    const totalObserved = Object.values(counts).reduce((a, b) => a + b, 0) + 1;
    let best: string | null = null;
    let bestDeficit = -Infinity;
    for (const b of V5_BUCKETS) {
      const weight = mix[b] ?? 0;
      if (weight <= 0) continue;
      if ((pool.get(b)?.length ?? 0) === 0) {
        if (!emptyBuckets.includes(b)) emptyBuckets.push(b);
        continue;
      }
      const deficit = (weight / 100) * totalObserved - counts[b];
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = b;
      }
    }
    if (!best) break;
    const c = pool.get(best)!.shift()!;
    selected.push(c);
    counts[best] += 1;
  }

  if (emptyBuckets.length > 0) {
    reasons.push(`Buckets sin elegibles (no se inventa nada): ${emptyBuckets.join(", ")}`);
  }
  if (selected.length < input.limit) {
    reasons.push(`Déficit: ${selected.length}/${input.limit} candidatos disponibles.`);
  }

  const deficitReport: Record<string, number> = {};
  const totalFinal = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  for (const b of V5_BUCKETS) deficitReport[b] = Number(((counts[b] / totalFinal) * 100).toFixed(2));

  return {
    selected,
    modeSnapshot: {
      mode: resolved.mode,
      source: resolved.source,
      comercial_id: input.comercialId,
      mix,
      history_size: history.length,
      prioridades: priorityJustifications,
      buckets_vacios: emptyBuckets,
      distribucion_resultante: deficitReport,
    },
    deficitReport,
    reasons,
  };
}