/**
 * Espejo servidor del flag del adaptador runtime V5 (src/lib/featureFlags.ts).
 *
 * OFF (estado actual): el productor legacy queda CONTENIDO — no inserta
 * ninguna tarea nueva (tampoco el formato histórico T-01…T-09).
 * ON: sólo el Motor V5 puede generar, una tarea por comercial y ciclo.
 */
export const FEATURE_V5_RUNTIME_ADAPTER = false;

export type V5RuntimeDecision = {
  /** ¿Puede el productor legacy insertar? Sólo si el flag está ON... nunca. */
  legacyWritesAllowed: boolean;
  v5EngineEnabled: boolean;
  reason: string;
};

export function decideRuntimeMode(
  flag: boolean = FEATURE_V5_RUNTIME_ADAPTER,
): V5RuntimeDecision {
  if (!flag) {
    return {
      legacyWritesAllowed: false,
      v5EngineEnabled: false,
      reason: "flag_off: contención legacy, cero inserciones (dry-run forzado)",
    };
  }
  return {
    legacyWritesAllowed: false,
    v5EngineEnabled: true,
    reason: "flag_on: sólo Motor V5 (una tarea por comercial y ciclo)",
  };
}
