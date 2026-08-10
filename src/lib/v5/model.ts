/**
 * MOTOR V5 — FASE A. Modelo canónico PURO.
 *
 * Este módulo no toca base de datos, no genera tareas reales y no se conecta
 * a la UI operativa. Vive detrás de FEATURE_V5_ENGINE_PHASE_A (OFF).
 *
 * T7 está EXCLUIDA del motor: nunca es un código válido.
 */

export const V5_RULES_VERSION = "v5a.1";

/** Códigos de tarea admitidos. T7 NO existe aquí a propósito. */
export const V5_TASK_CODES = ["T1", "T2_T3", "T4", "T5", "T6", "T8", "T9"] as const;
export type V5TaskCode = (typeof V5_TASK_CODES)[number];

export const V5_FORBIDDEN_TASK_CODES = ["T7", "T2", "T3"] as const;

export function isV5TaskCode(code: unknown): code is V5TaskCode {
  return typeof code === "string" && (V5_TASK_CODES as readonly string[]).includes(code);
}

export type V5SubjectType = "owner" | "building";
export type V5GenerationMode = "production" | "demo" | "manual";
export type V5ManualSubtype = "posible_interes" | "otro";

/** Familia T2_T3: una única tarjeta, nunca T2 y T3 por separado. */
export type V5T2T3Variant = "primera_llamada" | "whatsapp_pendiente";

export type V5Evidence = {
  /** Campo / señal observada. */
  field: string;
  observed: unknown;
  expected?: unknown;
  source: string;
  at?: string | null;
  quote?: string | null;
};

export type V5Incident = {
  field: string;
  observed: unknown;
  expected: unknown;
  source: string;
  evidence: V5Evidence[];
  action: string;
  /** Bloqueante = incidencia registral que impide operar el edificio. */
  blocking?: boolean;
  resolved?: boolean;
};

export type V5Signal = {
  kind: "interesado" | "no_interesado" | "neutro";
  at: string;
  source: string;
  valid?: boolean;
};

export type V5IdentityFlags = {
  ambiguousIdentity?: boolean;
  unresolvedDuplicate?: boolean;
  contradictoryRight?: boolean;
  unreconciledOwner?: boolean;
};

/** Campos comerciales permitidos para T5. Cuota/porcentaje/derecho quedan FUERA. */
export const V5_T5_ALLOWED_FIELDS = [
  "motivacion",
  "urgencia",
  "uso_actual",
  "situacion_arrendamiento",
  "expectativa_precio",
  "horizonte_temporal",
  "decisores",
  "canal_preferido",
] as const;
export type V5T5Field = (typeof V5_T5_ALLOWED_FIELDS)[number];

export const V5_T5_FORBIDDEN_FIELD_PATTERNS = [
  /cuota/i,
  /porcentaj/i,
  /%/,
  /derecho/i,
  /registral/i,
  /pleno/i,
  /usufruct/i,
  /nuda/i,
];

export function isAllowedT5Field(field: string): field is V5T5Field {
  if ((V5_T5_ALLOWED_FIELDS as readonly string[]).includes(field)) {
    return !V5_T5_FORBIDDEN_FIELD_PATTERNS.some((rx) => rx.test(field));
  }
  return false;
}

export type V5OwnerContext = {
  ownerId: string;
  buildingId: string;
  comercialId?: string | null;
  displayName?: string | null;
  /** Titular canónico contactable (para T9). */
  canonical?: boolean;
  contactable?: boolean;
  hasValidPhone: boolean;
  callCount: number;
  contactedEver: boolean;
  lastContactAt?: string | null;
  lastSignal?: V5Signal | null;
  /** Llamada posterior a la señal que la contradice. */
  contradictingCallAt?: string | null;
  whatsapp?: {
    consent?: boolean;
    authorizedNumber?: boolean;
    pendingContentAfterSignal?: boolean;
    sent?: boolean;
  } | null;
  cadence?: { dueAt?: string | null; channelUsable?: boolean } | null;
  identity?: V5IdentityFlags | null;
  /** Campos comerciales que faltan (se filtran por lista permitida). */
  missingCommercialFields?: string[] | null;
  /** Existe ya acción/candidato personal manual abierto. */
  hasOpenPersonalAction?: boolean;
  /** Incidencias concretas y accionables asociadas a este propietario. */
  incidents?: V5Incident[] | null;
};

export type V5BuildingContext = {
  buildingId: string;
  comercialId?: string | null;
  owners: V5OwnerContext[];
  incidents?: V5Incident[] | null;
  /** Coherencia registral, se alinea dentro de la T6. */
  sumaPlenoVerificado?: number | null;
  derechosVerificados?: number | null;
  bloqueosDerechos?: number | null;
  /** Última novedad relevante del edificio (T9 exige >= 90 días). */
  lastNoveltyAt?: string | null;
};

export type V5Candidate = {
  taskCode: V5TaskCode;
  subjectType: V5SubjectType;
  subjectId: string;
  buildingId: string;
  comercialId?: string | null;
  variant?: V5T2T3Variant;
  urgent?: boolean;
  blocking?: boolean;
  reason: string;
  evidence: V5Evidence[];
  eligibilitySnapshot: Record<string, unknown>;
  triggerFingerprint: string;
  taskKey: string;
  rulesVersion: string;
};

export type V5Rejection = {
  taskCode: V5TaskCode | "T7" | "unknown";
  subjectType: V5SubjectType;
  subjectId: string;
  buildingId: string;
  reason: string;
};

/** Hash determinista (djb2 -> hex). Sin aleatoriedad ni dependencia del día. */
export function fingerprint(parts: unknown): string {
  const text = stableStringify(parts);
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  let h2 = 52711;
  for (let i = text.length - 1; i >= 0; i--) {
    h2 = ((h2 << 5) + h2 + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Clave idempotente V5. NO depende del día:
 * v5:<rules_version>:<code>:<building>:<subject>:<fingerprint>
 */
export function buildV5TaskKey(input: {
  rulesVersion?: string;
  taskCode: V5TaskCode;
  buildingId: string;
  subjectId: string;
  triggerFingerprint: string;
}): string {
  if (!isV5TaskCode(input.taskCode)) {
    throw new Error(`Código de tarea no admitido en V5: ${String(input.taskCode)}`);
  }
  const rv = input.rulesVersion ?? V5_RULES_VERSION;
  return `v5:${rv}:${input.taskCode}:${input.buildingId}:${input.subjectId}:${input.triggerFingerprint}`;
}