/**
 * Modos de reparto de tareas comerciales — lógica PURA.
 *
 * Reglas fijas:
 *  - Grupos estables; T-02 y T-03 forman un ÚNICO grupo.
 *  - T-07 está deshabilitada: su peso es siempre 0.
 *  - Pesos enteros 0..100 y suma EXACTA 100 para poder guardar/activar.
 *  - "equilibrado" NO define porcentajes: hereda el reparto actual del motor V5.
 *  - Un cambio de modo sólo afecta a tareas FUTURAS.
 *  - Configuración inválida o ausente => se conserva el comportamiento actual.
 */

export type SalesTaskGroupCode = "T1" | "T2_T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T9";
export type SalesTaskModeCode = "iniciar_conversaciones" | "equilibrado" | "seguimiento" | "manual";

export type SalesTaskGroup = {
  code: SalesTaskGroupCode;
  label: string;
  members: string[];
  enabled: boolean;
};

export const SALES_TASK_GROUPS: readonly SalesTaskGroup[] = [
  { code: "T1", label: "T-01 Primer contacto", members: ["T-01"], enabled: true },
  { code: "T2_T3", label: "T-02 + T-03 Seguimiento", members: ["T-02", "T-03"], enabled: true },
  { code: "T4", label: "T-04 Reactivación", members: ["T-04"], enabled: true },
  { code: "T5", label: "T-05 Perfilado", members: ["T-05"], enabled: true },
  { code: "T6", label: "T-06 Incidencia registral", members: ["T-06"], enabled: true },
  { code: "T7", label: "T-07 (deshabilitada)", members: ["T-07"], enabled: false },
  { code: "T8", label: "T-08 Oportunidad caliente", members: ["T-08"], enabled: true },
  { code: "T9", label: "T-09 Edificio", members: ["T-09"], enabled: true },
] as const;

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
    followsEngineDefault: true,
    requiresWeights: false,
    description:
      "Reparto actual del motor V5 (cobertura de catálogo + prioridad). No define porcentajes propios.",
  },
  {
    code: "iniciar_conversaciones",
    label: "Iniciar conversaciones",
    followsEngineDefault: false,
    requiresWeights: true,
    description: "Prioriza el primer contacto. No se activa hasta guardar pesos válidos.",
  },
  {
    code: "seguimiento",
    label: "Seguimiento",
    followsEngineDefault: false,
    requiresWeights: true,
    description: "Prioriza seguimiento y reactivación. No se activa hasta guardar pesos válidos.",
  },
  {
    code: "manual",
    label: "Manual",
    followsEngineDefault: false,
    requiresWeights: true,
    description: "Pesos definidos a mano. No se activa hasta guardar pesos válidos.",
  },
] as const;

export type WeightMap = Partial<Record<SalesTaskGroupCode, number>>;

export type WeightValidation = {
  valid: boolean;
  total: number;
  errors: string[];
};

export function isKnownGroup(code: string): code is SalesTaskGroupCode {
  return SALES_TASK_GROUPS.some((g) => g.code === code);
}

export function validateWeights(weights: WeightMap | null | undefined): WeightValidation {
  const errors: string[] = [];
  if (!weights || typeof weights !== "object") {
    return { valid: false, total: 0, errors: ["No hay pesos definidos."] };
  }
  let total = 0;
  for (const [code, raw] of Object.entries(weights)) {
    if (!isKnownGroup(code)) {
      errors.push(`Grupo desconocido: ${code}`);
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      errors.push(`Peso no entero en ${code}`);
      continue;
    }
    if (value < 0 || value > 100) {
      errors.push(`Peso fuera de rango 0..100 en ${code}: ${value}`);
      continue;
    }
    const group = SALES_TASK_GROUPS.find((g) => g.code === code)!;
    if (!group.enabled && value !== 0) {
      errors.push(`El grupo ${code} está deshabilitado: su peso debe ser 0`);
      continue;
    }
    total += value;
  }
  if (total !== 100) errors.push(`La suma debe ser exactamente 100 (actual: ${total}).`);
  return { valid: errors.length === 0, total, errors };
}

export function emptyWeights(): WeightMap {
  const out: WeightMap = {};
  for (const g of SALES_TASK_GROUPS) out[g.code] = 0;
  return out;
}

/**
 * Reparto ponderado DETERMINISTA por déficit (largest remainder / mayor déficit).
 * No usa aleatoriedad: mismo input => mismo output.
 *
 * @param total  número de tareas a repartir
 * @param weights pesos válidos (suma 100)
 * @param available disponibilidad real por grupo (limita el reparto)
 */
export function allocateByWeights(
  total: number,
  weights: WeightMap,
  available?: Partial<Record<SalesTaskGroupCode, number>>,
): Record<string, number> {
  const result: Record<string, number> = {};
  const groups = SALES_TASK_GROUPS.filter((g) => g.enabled && (weights[g.code] ?? 0) > 0);
  for (const g of SALES_TASK_GROUPS) result[g.code] = 0;
  if (total <= 0 || groups.length === 0) return result;

  const cap = (code: SalesTaskGroupCode) =>
    available && Number.isFinite(available[code] as number)
      ? Math.max(0, Number(available[code]))
      : Number.POSITIVE_INFINITY;

  let assigned = 0;
  for (let i = 0; i < total; i++) {
    // En cada paso se elige el grupo con mayor déficit respecto a su cuota teórica.
    let best: SalesTaskGroupCode | null = null;
    let bestDeficit = -Infinity;
    for (const g of groups) {
      if (result[g.code] >= cap(g.code)) continue;
      const target = ((weights[g.code] ?? 0) / 100) * (assigned + 1);
      const deficit = target - result[g.code];
      // Desempate estable por orden de catálogo.
      if (deficit > bestDeficit + 1e-9) {
        bestDeficit = deficit;
        best = g.code;
      }
    }
    if (!best) break;
    result[best] += 1;
    assigned += 1;
  }
  return result;
}
