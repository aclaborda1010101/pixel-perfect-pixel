/**
 * Modos de reparto de tareas comerciales — lógica PURA.
 *
 * Catálogo: se deriva del catálogo V5 canónico ya existente
 * (src/lib/v5/model.ts -> V5_TASK_CODES). NO se inventan etiquetas de negocio:
 * los textos de las tareas T-0x no están versionados en el repositorio, así que
 * la UI muestra el CÓDIGO y la marca "pendiente validar".
 *
 * Reglas fijas:
 *  - Grupos = códigos V5 (T2_T3 es un grupo ÚNICO) + T7, que está DESHABILITADA.
 *  - Una configuración de pesos debe declarar EXACTAMENTE todos los grupos:
 *    todos los habilitados presentes, T7 presente con valor 0, sin extras.
 *  - Pesos enteros estrictos 0..100 y suma EXACTA 100.
 *  - "equilibrado" NO define porcentajes: hereda el reparto actual del motor V5.
 *  - Un cambio de modo sólo afecta a tareas FUTURAS.
 */

import { V5_TASK_CODES } from "@/lib/v5/model";

export type SalesTaskGroupCode = (typeof V5_TASK_CODES)[number] | "T7";
export type SalesTaskModeCode = "iniciar_conversaciones" | "equilibrado" | "seguimiento" | "manual";

export type SalesTaskGroup = {
  code: SalesTaskGroupCode;
  /** Etiqueta neutra: código + aviso. No se inventan nombres de negocio. */
  label: string;
  members: string[];
  enabled: boolean;
};

/** Marca explícita: los textos de negocio no están versionados. */
export const PENDIENTE_VALIDAR = "pendiente validar";

function membersOf(code: SalesTaskGroupCode): string[] {
  return code === "T2_T3" ? ["T-02", "T-03"] : [`T-0${code.slice(1)}`];
}

export const SALES_TASK_GROUPS: readonly SalesTaskGroup[] = [
  ...V5_TASK_CODES.map((code) => ({
    code: code as SalesTaskGroupCode,
    label: `${code} (${PENDIENTE_VALIDAR})`,
    members: membersOf(code as SalesTaskGroupCode),
    enabled: true,
  })),
  { code: "T7", label: `T7 (deshabilitada, ${PENDIENTE_VALIDAR})`, members: ["T-07"], enabled: false },
] as const;

export const SALES_TASK_GROUP_CODES: readonly SalesTaskGroupCode[] = SALES_TASK_GROUPS.map((g) => g.code);
export const ENABLED_GROUP_CODES: readonly SalesTaskGroupCode[] = SALES_TASK_GROUPS.filter((g) => g.enabled).map(
  (g) => g.code,
);

export const SALES_TASK_MODES: readonly {
  code: SalesTaskModeCode;
  label: string;
  followsEngineDefault: boolean;
  requiresWeights: boolean;
  description: string;
}[] = [
  {
    code: "equilibrado",
    label: "Equilibrado",
    followsEngineDefault: false,
    requiresWeights: true,
    description:
      "Genera tareas automáticas. Sus porcentajes los define el panel: no se siembra ninguna distribución.",
  },
  {
    code: "iniciar_conversaciones",
    label: "Iniciar conversaciones",
    followsEngineDefault: false,
    requiresWeights: true,
    description: "Genera tareas automáticas. Requiere un mapa de pesos completo y válido antes de activarse.",
  },
  {
    code: "seguimiento",
    label: "Seguimiento",
    followsEngineDefault: false,
    requiresWeights: true,
    description: "Genera tareas automáticas. Requiere un mapa de pesos completo y válido antes de activarse.",
  },
  {
    code: "manual",
    label: "Manual (personalizado)",
    followsEngineDefault: false,
    requiresWeights: true,
    description:
      "Porcentajes definidos a mano. TAMBIÉN genera tareas automáticas: no es una pausa. Requiere mapa completo y válido.",
  },
] as const;

/**
 * Pausa de generación automática: interruptor SEPARADO del modo.
 * Modelo declarado y apagado; NO está conectado al motor (Fase C).
 */
export type SalesTaskGenerationState = { paused: boolean; connected: false };
export const DEFAULT_GENERATION_STATE: SalesTaskGenerationState = { paused: false, connected: false };

/** Ningún modo (incluido manual) se activa sin mapa completo y válido. */
export function isModeConfigured(weights: WeightMap | null | undefined): boolean {
  return validateWeights(weights).valid;
}

/** Etiqueta autoritativa para el panel: nunca afirma que ya afecta al motor. */
export function modeConfigLabel(weights: WeightMap | null | undefined): "configurado" | "no configurado" {
  return isModeConfigured(weights) ? "configurado" : "no configurado";
}

export type WeightMap = Partial<Record<SalesTaskGroupCode, number>>;
export type WeightValidation = { valid: boolean; total: number; errors: string[] };

export function isKnownGroup(code: string): code is SalesTaskGroupCode {
  return (SALES_TASK_GROUP_CODES as readonly string[]).includes(code);
}

/**
 * Validación ESTRICTA y completa. Falla (no "corrige") ante:
 *  grupos faltantes, extras, T7 != 0, decimales, strings, NaN, negativos,
 *  valores > 100 o suma != 100.
 */
export function validateWeights(weights: WeightMap | null | undefined): WeightValidation {
  const errors: string[] = [];
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    return { valid: false, total: 0, errors: ["No hay pesos definidos."] };
  }
  let total = 0;

  const entries = Object.entries(weights as Record<string, unknown>);
  for (const [code, raw] of entries) {
    if (!isKnownGroup(code)) {
      errors.push(`Grupo desconocido: ${code}`);
      continue;
    }
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      errors.push(`Peso no entero en ${code}: ${String(raw)}`);
      continue;
    }
    if (raw < 0 || raw > 100) {
      errors.push(`Peso fuera de rango 0..100 en ${code}: ${raw}`);
      continue;
    }
    const group = SALES_TASK_GROUPS.find((g) => g.code === code)!;
    if (!group.enabled && raw !== 0) {
      errors.push(`El grupo ${code} está deshabilitado: su peso debe ser 0`);
      continue;
    }
    total += raw;
  }

  for (const g of SALES_TASK_GROUPS) {
    if (!(g.code in (weights as object))) {
      errors.push(
        g.enabled
          ? `Falta el grupo ${g.code}: la configuración debe declarar todos los grupos`
          : `Falta el grupo deshabilitado ${g.code}: debe declararse con peso 0`,
      );
    }
  }

  if (total !== 100) errors.push(`La suma debe ser exactamente 100 (actual: ${total}).`);
  return { valid: errors.length === 0, total, errors };
}

/** Plantilla vacía COMPLETA: todos los grupos a 0 (todavía inválida: suma 0). */
export function emptyWeights(): Record<SalesTaskGroupCode, number> {
  const out = {} as Record<SalesTaskGroupCode, number>;
  for (const g of SALES_TASK_GROUPS) out[g.code] = 0;
  return out;
}

/**
 * Elige UNA sola cesta por MAYOR DÉFICIT acumulado. Determinista y sin estado:
 *
 * @param weights       pesos validados (suma 100)
 * @param actualCounts  reparto ya realizado (histórico + lo asignado en esta ronda)
 * @param eligibleCounts candidatos realmente disponibles por grupo
 * @returns el código elegido, o null si ningún grupo con peso tiene elegibles
 */
export function chooseNextGroup(
  weights: WeightMap,
  actualCounts: Partial<Record<SalesTaskGroupCode, number>> = {},
  eligibleCounts: Partial<Record<SalesTaskGroupCode, number>> = {},
): SalesTaskGroupCode | null {
  const assigned = SALES_TASK_GROUP_CODES.reduce((a, c) => a + (Number(actualCounts[c]) || 0), 0);
  let best: SalesTaskGroupCode | null = null;
  let bestDeficit = -Infinity;

  for (const g of SALES_TASK_GROUPS) {
    if (!g.enabled) continue;
    const w = Number(weights[g.code]) || 0;
    if (w <= 0) continue;
    const disponibles = Number(eligibleCounts[g.code]);
    if (Number.isFinite(disponibles) && disponibles <= 0) continue;
    const actual = Number(actualCounts[g.code]) || 0;
    const target = (w / 100) * (assigned + 1);
    const deficit = target - actual;
    // Desempate ESTABLE por orden de catálogo (el primero gana).
    if (deficit > bestDeficit + 1e-9) {
      bestDeficit = deficit;
      best = g.code;
    }
  }
  return best;
}

/**
 * Reparto determinista de `total` tareas aplicando chooseNextGroup en bucle.
 * `available` limita por disponibilidad real; nunca inventa candidatos.
 */
export function allocateByWeights(
  total: number,
  weights: WeightMap,
  available?: Partial<Record<SalesTaskGroupCode, number>>,
): Record<string, number> {
  const result = {} as Record<SalesTaskGroupCode, number>;
  for (const g of SALES_TASK_GROUPS) result[g.code] = 0;
  if (!Number.isFinite(total) || total <= 0) return result;

  const restante: Partial<Record<SalesTaskGroupCode, number>> = {};
  for (const g of SALES_TASK_GROUPS) {
    const cap = available?.[g.code];
    restante[g.code] = Number.isFinite(cap as number) ? Math.max(0, Number(cap)) : Number.POSITIVE_INFINITY;
  }

  for (let i = 0; i < total; i++) {
    const next = chooseNextGroup(weights, result, restante);
    if (!next) break;
    result[next] += 1;
    if (Number.isFinite(restante[next] as number)) restante[next] = Number(restante[next]) - 1;
  }
  return result;
}
