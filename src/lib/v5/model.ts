/**
 * MOTOR V5 — FASE A.1. Modelo canónico PURO.
 *
 * No toca base de datos, no genera tareas reales, no hay UI conectada.
 * Vive detrás de FEATURE_V5_ENGINE_PHASE_A (OFF).
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

/**
 * DOMINIO PERSISTIBLE de generation_mode.
 *
 * legacy = filas anteriores al motor (nunca se reclasifican ni se
 * interpretan como manual). production | manual son SIEMPRE explícitos.
 *
 * 'demo' YA NO EXISTE en el dominio persistible: la demo es preview puro
 * en memoria (ver manualDemo.ts) y nunca llega a building_tasks.
 */
export const V5_GENERATION_MODES = ["legacy", "production", "manual"] as const;
export type V5GenerationMode = (typeof V5_GENERATION_MODES)[number];

/** Modo de PREVIEW, jamás persistible. */
export const V5_PREVIEW_MODE = "demo" as const;

export function isPersistableGenerationMode(mode: unknown): mode is V5GenerationMode {
  return typeof mode === "string" && (V5_GENERATION_MODES as readonly string[]).includes(mode);
}

/** Modos cuyas tareas son REALES e iniciables (las manuales también lo son). */
export const V5_STARTABLE_GENERATION_MODES = ["production", "manual"] as const;

export type V5ManualSubtype = "posible_interes" | "otro";

/** Evidencia real: exige fuente Y referencia trazable. */
export type V5Evidence = {
  field: string;
  observed: unknown;
  expected?: unknown;
  source: string;
  /** Referencia trazable (nota:123#p2, call:987, msg:abc...). Obligatoria. */
  reference: string;
  at?: string | null;
  quote?: string | null;
};

export function isValidEvidence(e: unknown): e is V5Evidence {
  if (!e || typeof e !== "object") return false;
  const v = e as Partial<V5Evidence>;
  return (
    typeof v.field === "string" && v.field.trim().length > 0 &&
    typeof v.source === "string" && v.source.trim().length > 0 &&
    typeof v.reference === "string" && v.reference.trim().length > 0
  );
}

/** Incidencia concreta: id estable + field + action + source + evidencia válida. */
export type V5Incident = {
  id: string;
  field: string;
  observed: unknown;
  expected: unknown;
  source: string;
  action: string;
  evidence: V5Evidence[];
  /** Bloqueante duro: impide operar el edificio. */
  blocking?: boolean;
  /** Sólo si la regla lo declara explícitamente puede coexistir con personales. */
  coexistsWithPersonal?: boolean;
  coexistenceRule?: string | null;
  resolved?: boolean;
};

export function isConcreteIncident(inc: unknown): inc is V5Incident {
  if (!inc || typeof inc !== "object") return false;
  const v = inc as Partial<V5Incident>;
  if (v.resolved === true) return false;
  if (typeof v.id !== "string" || v.id.trim().length === 0) return false;
  if (typeof v.field !== "string" || v.field.trim().length === 0) return false;
  if (typeof v.action !== "string" || v.action.trim().length === 0) return false;
  if (typeof v.source !== "string" || v.source.trim().length === 0) return false;
  if (!Array.isArray(v.evidence) || v.evidence.length === 0) return false;
  return v.evidence.every(isValidEvidence);
}

/**
 * Firma CANÓNICA y determinista de una incidencia (P0.2).
 * Incluye TODA la evidencia: id, field, observed, expected, source, action,
 * blocking, reference, at, quote. Ordena y deduplica: dos incidencias
 * iguales tienen exactamente la misma firma, y un cambio material sólo en
 * la evidencia (cita, referencia, fecha) cambia la firma.
 */
export function incidentSignature(inc: V5Incident): string {
  const evidence = [...inc.evidence]
    .map((e) => ({
      field: e.field,
      observed: e.observed ?? null,
      expected: e.expected ?? null,
      source: e.source,
      reference: e.reference,
      at: e.at ?? null,
      quote: e.quote ?? null,
    }))
    .map((e) => [stableStringify(e), e] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dedupedEvidence: unknown[] = [];
  let prev: string | null = null;
  for (const [sig, e] of evidence) {
    if (sig === prev) continue;
    prev = sig;
    dedupedEvidence.push(e);
  }
  return stableStringify({
    id: inc.id,
    field: inc.field,
    observed: inc.observed ?? null,
    expected: inc.expected ?? null,
    source: inc.source,
    action: inc.action,
    blocking: inc.blocking === true,
    evidence: dedupedEvidence,
  });
}

/** Id trazable no vacío tras trim. `true`/números no valen como id. */
export function isTraceableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Timestamp ISO válido y NO futuro respecto a `now`. */
export function isValidPastTimestamp(value: unknown, now: Date = new Date()): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && t <= now.getTime();
}

export type V5Signal = {
  /** Id trazable de la señal (evento/llamada/mensaje). */
  id?: string | null;
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

/** T2_T3 es UNA tarjeta con varias acciones/checkpoints que conviven. */
export const V5_T2T3_ACTIONS = ["primera_llamada", "registrar_consentimiento", "enviar_whatsapp"] as const;
export type V5T2T3ActionKind = (typeof V5_T2T3_ACTIONS)[number];

export type V5T2T3Action = {
  kind: V5T2T3ActionKind;
  reason: string;
  /** Ids trazables que entran en el fingerprint. */
  refs: { signalId?: string | null; messageId?: string | null; eventId?: string | null };
  evidence: V5Evidence[];
  done?: boolean;
};

export type V5ContactEvent = { at: string; source: string; eventId: string };

export type V5OwnerContext = {
  ownerId: string;
  buildingId: string;
  comercialId?: string | null;
  displayName?: string | null;
  /** T9 exige canonical===true y contactable===true EXPLÍCITOS. */
  canonical?: boolean;
  contactable?: boolean;
  hasValidPhone: boolean;
  callCount: number;
  contactedEver: boolean;
  /** Evento real de contacto (T9 no admite `true` como evidencia). */
  lastContact?: V5ContactEvent | null;
  lastContactAt?: string | null;
  lastSignal?: V5Signal | null;
  /** Llamada posterior a la señal que la contradice. */
  contradictingCallAt?: string | null;
  contradictingCallId?: string | null;
  whatsapp?: {
    consent?: boolean;
    consentEventId?: string | null;
    /** Marca explícita de "hay que registrar consentimiento". */
    consentPending?: boolean;
    authorizedNumber?: boolean;
    pendingContentAfterSignal?: boolean;
    pendingMessageId?: string | null;
    sentMessageIds?: string[] | null;
    sent?: boolean;
  } | null;
  cadence?: { dueAt?: string | null; channelUsable?: boolean } | null;
  identity?: V5IdentityFlags | null;
  missingCommercialFields?: string[] | null;
  hasOpenPersonalAction?: boolean;
  incidents?: V5Incident[] | null;
  /** Instancia del disparador: un evento materialmente nuevo trae id nuevo. */
  triggerInstanceId?: string | null;
};

export type V5BuildingContext = {
  buildingId: string;
  comercialId?: string | null;
  owners: V5OwnerContext[];
  incidents?: V5Incident[] | null;
  /** T9 exige universo de titularidad completo y explícito. */
  ownershipUniverseComplete?: boolean;
  sumaPlenoVerificado?: number | null;
  derechosVerificados?: number | null;
  bloqueosDerechos?: number | null;
  lastNoveltyAt?: string | null;
};

export type V5Candidate = {
  taskCode: V5TaskCode;
  subjectType: V5SubjectType;
  subjectId: string;
  buildingId: string;
  comercialId?: string | null;
  /** Sólo T2_T3: acciones que conviven en la misma tarjeta. */
  actions?: V5T2T3Action[];
  checkpoints?: string[];
  urgent?: boolean;
  blocking?: boolean;
  /** Sólo T6 hard-blocking: qué tareas personales se suprimieron. */
  suppressedPersonal?: { subjectId: string; taskCode: V5TaskCode | "ninguna"; reason: string }[];
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

/** Segmento de código dentro de una task_key V5 (concordancia con task_code). */
export function taskCodeFromV5Key(taskKey: string | null | undefined): string | null {
  if (!taskKey || !taskKey.startsWith("v5:")) return null;
  const parts = taskKey.split(":");
  return parts.length >= 3 ? parts[2] : null;
}
