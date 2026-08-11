/**
 * MOTOR V5 — FASE A.1. Modos PUROS (no conectados al motor real).
 *
 * Los modos SOLO seleccionan entre candidatos ya elegibles: nunca crean
 * candidatos ni relajan reglas. T7 se rechaza siempre.
 *
 * IMPORTANTE: los tres modos predefinidos EXISTEN pero NO tienen pesos.
 * No se inventan: quedan NO ACTIVABLES hasta que Carlos Moreno o Carlos Sanz
 * guarden los 7 buckets desde el panel.
 */

import type { V5Candidate, V5TaskCode } from "./model.ts";
import { V5_TASK_CODES } from "./model.ts";

export type V5Bucket = V5TaskCode;
export const V5_BUCKETS: readonly V5Bucket[] = V5_TASK_CODES;

/**
 * Los CUATRO modos comerciales. `personalizado` (histórico: "manual") es un
 * modo comercial que SÍ genera automáticas con su propio mapa de pesos: no
 * tiene nada que ver con generation_mode='manual' (tarea creada por una
 * persona, ver manualDemo.ts).
 */
export const V5_COMMERCIAL_MODES = [
  "iniciar_conversaciones",
  "equilibrado",
  "seguimiento",
  "personalizado",
] as const;
export type V5ModeCode = (typeof V5_COMMERCIAL_MODES)[number] | "manual";
export type V5Mix = Partial<Record<string, number>>;

/** Alias histórico: el modo comercial "manual" ES "personalizado". */
export function normalizeModeCode(mode: V5ModeCode): Exclude<V5ModeCode, "manual"> {
  return mode === "manual" ? "personalizado" : mode;
}

/** Únicos autorizados a guardar pesos. */
export const V5_MODE_WEIGHT_EDITORS = ["carlos.moreno", "carlos.sanz"] as const;

/** Los códigos existen; el mix es null hasta que se guarde en panel. */
export const V5_PREDEFINED_MODES: Record<Exclude<V5ModeCode, "manual">, { mix: null }> = {
  iniciar_conversaciones: { mix: null },
  equilibrado: { mix: null },
  seguimiento: { mix: null },
  personalizado: { mix: null },
};

export type V5MixValidation = { valid: boolean; total: number; errors: string[] };

/**
 * Validación EXACTA: los 7 buckets generables, enteros, suma 100.
 * T7 puede venir en el mapa completo del panel, pero SÓLO con valor 0 y se
 * elimina antes del selector: nunca es generable.
 */
export function validateMix(mix: V5Mix | null | undefined): V5MixValidation {
  const errors: string[] = [];
  if (!mix || typeof mix !== "object") {
    return { valid: false, total: 0, errors: ["No hay mezcla guardada: el modo no es activable."] };
  }
  let total = 0;
  for (const [code, raw] of Object.entries(mix)) {
    if (code === "T7") {
      if (Number(raw) !== 0) errors.push("T7 está excluida del motor V5: sólo admite 0.");
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
  for (const b of V5_BUCKETS) {
    if (!(b in mix)) errors.push(`Falta el bucket ${b} (cero es válido, ausente no).`);
  }
  if (total !== 100) errors.push(`La suma debe ser exactamente 100 (actual: ${total}).`);
  return { valid: errors.length === 0, total, errors };
}

/** Mapa listo para el selector: T7 eliminada (no se considera generable). */
export function generableMix(mix: V5Mix): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, raw] of Object.entries(mix)) {
    if (code === "T7") continue;
    if (!(V5_BUCKETS as readonly string[]).includes(code)) continue;
    out[code] = Number(raw) || 0;
  }
  return out;
}

/**
 * NINGÚN modo se activa sin mapa completo: el modo `personalizado` (alias
 * histórico `manual`) también genera tareas automáticas, no es una pausa.
 */
export function isModeActivatable(mode: V5ModeCode, mix: V5Mix | null | undefined): { activatable: boolean; errors: string[] } {
  void mode;
  if (Array.isArray(mix) || typeof mix === "string") {
    return { activatable: false, errors: ["El mapa de pesos debe ser un objeto."] };
  }
  const v = validateMix(mix);
  return {
    activatable: v.valid,
    errors: v.valid ? [] : ["Modo no activable hasta que Carlos Moreno o Carlos Sanz guarden los pesos.", ...v.errors],
  };
}

/**
 * Pausa de generación: interruptor SEPARADO del modo, apagado y NO conectado.
 */
export const V5_GENERATION_PAUSED_DEFAULT = false;

export type V5ModeConfig = {
  global: { mode: V5ModeCode; mix?: V5Mix | null };
  /** Override por comercial: SIEMPRE gana al global. */
  overrides?: Record<string, { mode: V5ModeCode; mix?: V5Mix | null }> | null;
};

export function resolveModeFor(
  comercialId: string | null | undefined,
  config: V5ModeConfig,
): { mode: V5ModeCode; mix: V5Mix | null; source: "override" | "global" } {
  const ov = comercialId ? config.overrides?.[comercialId] : undefined;
  const chosen = ov ?? config.global;
  const source: "override" | "global" = ov ? "override" : "global";
  // El modo personalizado (alias `manual`) CONSERVA su mapa completo.
  return { mode: normalizeModeCode(chosen.mode), mix: chosen.mix ?? null, source };
}

export type V5WindowEntry = { taskKey: string; bucket: string };
export const V5_WINDOW_SIZE = 20;

export type V5SelectNextInput = {
  comercialId: string | null;
  candidates: readonly V5Candidate[];
  config: V5ModeConfig;
  /** Ventana móvil de las últimas 20 selecciones (la más reciente primero). */
  window?: readonly V5WindowEntry[];
  now?: Date;
};

export type V5SelectNextResult = {
  selected: V5Candidate | null;
  window: V5WindowEntry[];
  modeSnapshot: Record<string, unknown>;
  reasons: string[];
  rejected: { taskKey: string; reason: string }[];
};

function bucketCounts(entries: readonly V5WindowEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of V5_BUCKETS) out[b] = 0;
  for (const e of entries) if (e.bucket in out) out[e.bucket] += 1;
  return out;
}

function isUrgent(c: V5Candidate): boolean {
  return (c.taskCode === "T8" && c.urgent === true) || (c.taskCode === "T6" && c.blocking === true);
}

/** Selecciona 0 o 1 candidato. Nunca más. Nunca de otro comercial. */
export function selectNextByMode(input: V5SelectNextInput): V5SelectNextResult {
  const reasons: string[] = [];
  const rejected: { taskKey: string; reason: string }[] = [];
  const windowIn = (input.window ?? []).slice(0, V5_WINDOW_SIZE);
  const resolved = resolveModeFor(input.comercialId, input.config);

  const base = {
    mode: normalizeModeCode(resolved.mode),
    source: resolved.source,
    comercial_id: input.comercialId,
    window_size: windowIn.length,
  };

  const activatable = isModeActivatable(resolved.mode, resolved.mix);
  if (!activatable.activatable) {
    return {
      selected: null,
      window: [...windowIn],
      modeSnapshot: { ...base, activable: false, errores: activatable.errors },
      reasons: activatable.errors,
      rejected,
    };
  }
  const mix = generableMix(resolved.mix as V5Mix);

  const inWindow = new Set(windowIn.map((e) => e.taskKey));
  const pool: V5Candidate[] = [];
  const seenKeys = new Set<string>();
  for (const c of input.candidates) {
    if ((c.comercialId ?? null) !== input.comercialId) {
      rejected.push({ taskKey: c.taskKey, reason: `candidato de comercial ${String(c.comercialId)} ≠ ${String(input.comercialId)}` });
      continue;
    }
    if (!(V5_BUCKETS as readonly string[]).includes(c.taskCode)) {
      rejected.push({ taskKey: c.taskKey, reason: `bucket no admitido: ${c.taskCode}` });
      continue;
    }
    if (inWindow.has(c.taskKey) || seenKeys.has(c.taskKey)) {
      rejected.push({ taskKey: c.taskKey, reason: "duplicado por task_key" });
      continue;
    }
    seenKeys.add(c.taskKey);
    pool.push(c);
  }
  if (rejected.length > 0) reasons.push(`Candidatos descartados: ${rejected.length}`);
  pool.sort((a, b) => (a.taskKey < b.taskKey ? -1 : a.taskKey > b.taskKey ? 1 : 0));

  let chosen: V5Candidate | null = null;
  let urgentJustification: Record<string, unknown> | null = null;

  const urgentCandidate = pool.find(isUrgent);
  if (urgentCandidate) {
    chosen = urgentCandidate;
    urgentJustification = {
      task_key: urgentCandidate.taskKey,
      bucket: urgentCandidate.taskCode,
      motivo: urgentCandidate.taskCode === "T8" ? "T8 urgente gana al reparto (una vez)." : "T6 bloqueante gana al reparto (una vez).",
    };
  } else {
    const counts = bucketCounts(windowIn);
    const totalObserved = windowIn.length + 1;
    const vacios: string[] = [];
    let bestDeficit = -Infinity;
    for (const b of V5_BUCKETS) {
      const weight = mix[b] ?? 0;
      if (weight <= 0) continue;
      const available = pool.filter((c) => c.taskCode === b);
      if (available.length === 0) {
        vacios.push(b);
        continue;
      }
      const deficit = (weight / 100) * totalObserved - counts[b];
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        chosen = available[0];
      }
    }
    if (vacios.length > 0) reasons.push(`Buckets sin elegibles (no se inventa nada): ${vacios.join(", ")}`);
  }

  if (!chosen) {
    reasons.push("Sin candidato seleccionable para este comercial.");
    return { selected: null, window: [...windowIn], modeSnapshot: { ...base, mix }, reasons, rejected };
  }

  // Ventana móvil real: entra el nuevo, sale el más antiguo.
  const window = [{ taskKey: chosen.taskKey, bucket: chosen.taskCode }, ...windowIn].slice(0, V5_WINDOW_SIZE);

  return {
    selected: chosen,
    window,
    modeSnapshot: {
      ...base,
      mix,
      seleccion: { task_key: chosen.taskKey, bucket: chosen.taskCode },
      urgente: urgentJustification,
      distribucion_ventana: bucketCounts(window),
    },
    reasons,
    rejected,
  };
}
