/**
 * MOTOR V5 — FASE A. Elegibilidad y precedencia PURAS.
 *
 * Orden obligatorio: primero ELEGIBILIDAD (qué puede existir), después
 * SELECCIÓN (modos). Los modos NUNCA crean candidatos.
 */

import {
  V5_RULES_VERSION,
  buildV5TaskKey,
  fingerprint,
  isAllowedT5Field,
  type V5BuildingContext,
  type V5Candidate,
  type V5Evidence,
  type V5Incident,
  type V5OwnerContext,
  type V5Rejection,
  type V5TaskCode,
} from "./model";

export type V5EligibilityResult = {
  candidates: V5Candidate[];
  rejections: V5Rejection[];
  /** Motivos por sujeto: trazabilidad completa aunque no haya candidato. */
  notes: { subjectId: string; subjectType: "owner" | "building"; reason: string }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function ts(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function identityBlockers(owner: V5OwnerContext): string[] {
  const id = owner.identity ?? {};
  const out: string[] = [];
  if (id.ambiguousIdentity) out.push("identidad_ambigua");
  if (id.unresolvedDuplicate) out.push("duplicado_no_resuelto");
  if (id.contradictoryRight) out.push("derecho_contradictorio");
  if (id.unreconciledOwner) out.push("propietario_no_conciliado");
  return out;
}

function actionableIncidents(incidents?: V5Incident[] | null): V5Incident[] {
  return (incidents ?? []).filter(
    (inc) =>
      !inc.resolved &&
      !!inc.field &&
      !!inc.action &&
      Array.isArray(inc.evidence) &&
      inc.evidence.length > 0,
  );
}

function makeCandidate(input: {
  taskCode: V5TaskCode;
  subjectType: "owner" | "building";
  subjectId: string;
  buildingId: string;
  comercialId?: string | null;
  variant?: V5Candidate["variant"];
  urgent?: boolean;
  blocking?: boolean;
  reason: string;
  evidence: V5Evidence[];
  trigger: Record<string, unknown>;
  snapshotExtra?: Record<string, unknown>;
}): V5Candidate {
  const fp = fingerprint({
    code: input.taskCode,
    building: input.buildingId,
    subject: input.subjectId,
    trigger: input.trigger,
  });
  return {
    taskCode: input.taskCode,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    buildingId: input.buildingId,
    comercialId: input.comercialId ?? null,
    variant: input.variant,
    urgent: input.urgent ?? false,
    blocking: input.blocking ?? false,
    reason: input.reason,
    evidence: input.evidence,
    eligibilitySnapshot: {
      rules_version: V5_RULES_VERSION,
      task_code: input.taskCode,
      trigger: input.trigger,
      ...(input.snapshotExtra ?? {}),
    },
    triggerFingerprint: fp,
    taskKey: buildV5TaskKey({
      taskCode: input.taskCode,
      buildingId: input.buildingId,
      subjectId: input.subjectId,
      triggerFingerprint: fp,
    }),
    rulesVersion: V5_RULES_VERSION,
  };
}

/**
 * Precedencia por propietario-edificio: MÁXIMO una recomendación personal.
 * Orden: bloqueos de identidad > T8 > T2_T3 > T4 > T1 > T5.
 */
export function evaluateOwner(
  owner: V5OwnerContext,
  opts: { now?: Date } = {},
): { candidate: V5Candidate | null; blockers: string[]; reason: string } {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const blockers = identityBlockers(owner);

  if (blockers.length > 0) {
    return {
      candidate: null,
      blockers,
      reason: `Tareas personales bloqueadas: ${blockers.join(", ")}`,
    };
  }

  const signal = owner.lastSignal && owner.lastSignal.valid !== false ? owner.lastSignal : null;
  const signalMs = ts(signal?.at);
  const contradictMs = ts(owner.contradictingCallAt);
  const contradicted =
    signalMs !== null && contradictMs !== null && contradictMs > signalMs;

  // --- T8: interés vigente. Gana a todas las automáticas.
  if (signal?.kind === "interesado" && !contradicted) {
    return {
      candidate: makeCandidate({
        taskCode: "T8",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        urgent: true,
        reason: "Última señal válida = interesado y sin llamada posterior que la contradiga.",
        evidence: [
          { field: "senal", observed: signal.kind, source: signal.source, at: signal.at },
        ],
        trigger: { signal_at: signal.at, signal_kind: signal.kind, source: signal.source },
      }),
      blockers,
      reason: "T8 por interés vigente",
    };
  }

  // --- T1: falta teléfono válido -> investigar/verificar datos, NO llamar.
  if (!owner.hasValidPhone) {
    return {
      candidate: makeCandidate({
        taskCode: "T1",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        reason: "No hay teléfono válido: verificar e investigar datos de contacto (no llamar).",
        evidence: [
          { field: "telefono", observed: null, expected: "teléfono válido", source: "crm" },
        ],
        trigger: { missing_phone: true },
        snapshotExtra: { accion: "investigar_datos", llamar: false },
      }),
      blockers,
      reason: "T1 por falta de teléfono válido",
    };
  }

  // --- T2_T3: UNA sola tarjeta/familia.
  const wa = owner.whatsapp ?? {};
  if (owner.hasValidPhone && owner.callCount === 0) {
    return {
      candidate: makeCandidate({
        taskCode: "T2_T3",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        variant: "primera_llamada",
        reason: "Teléfono válido y cero llamadas registradas: primera llamada.",
        evidence: [{ field: "llamadas", observed: 0, expected: ">0", source: "hubspot" }],
        trigger: { variant: "primera_llamada", call_count: 0 },
      }),
      blockers,
      reason: "T2_T3 primera llamada",
    };
  }
  if (wa.consent === true && wa.authorizedNumber === true && wa.pendingContentAfterSignal === true) {
    return {
      candidate: makeCandidate({
        taskCode: "T2_T3",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        variant: "whatsapp_pendiente",
        reason: "Consentimiento válido, número autorizado y contenido pendiente tras la señal.",
        evidence: [
          { field: "consentimiento_whatsapp", observed: true, source: "wa_consent_signals" },
          { field: "contenido_pendiente", observed: true, source: "wa_conversations" },
        ],
        trigger: { variant: "whatsapp_pendiente", consent: true, authorized: true },
      }),
      blockers,
      reason: "T2_T3 WhatsApp pendiente",
    };
  }

  // --- T4: cadencia realmente vencida.
  const dueMs = ts(owner.cadence?.dueAt);
  const cadenceDue = dueMs !== null && dueMs <= nowMs;
  if (cadenceDue && signal?.kind !== "interesado" && owner.cadence?.channelUsable === true) {
    return {
      candidate: makeCandidate({
        taskCode: "T4",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        reason: "Cadencia vencida, última señal no interesada y canal utilizable.",
        evidence: [
          { field: "cadencia_due_at", observed: owner.cadence?.dueAt, source: "cadence_steps" },
          { field: "ultima_senal", observed: signal?.kind ?? "ninguna", source: signal?.source ?? "n/a" },
        ],
        trigger: { cadence_due_at: owner.cadence?.dueAt ?? null },
      }),
      blockers,
      reason: "T4 por cadencia vencida",
    };
  }

  // --- T5: perfilado. Nunca cuota/porcentaje/derecho registral.
  const missing = (owner.missingCommercialFields ?? []).filter(isAllowedT5Field);
  if (owner.contactedEver && missing.length >= 2) {
    return {
      candidate: makeCandidate({
        taskCode: "T5",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        reason: `Contacto previo y ${missing.length} campos comerciales pendientes.`,
        evidence: missing.map((f) => ({ field: f, observed: null, source: "crm" })),
        trigger: { missing_fields: [...missing].sort() },
        snapshotExtra: { campos_permitidos: [...missing].sort() },
      }),
      blockers,
      reason: "T5 por perfilado incompleto",
    };
  }

  return { candidate: null, blockers, reason: "Sin trigger personal elegible" };
}

/** T6: UNA por edificio, agrupando incidencias con evidencia. */
export function evaluateBuildingT6(building: V5BuildingContext): V5Candidate | null {
  const all = [
    ...actionableIncidents(building.incidents),
    ...building.owners.flatMap((o) =>
      actionableIncidents(o.incidents).map((inc) => ({ ...inc, source: inc.source || `owner:${o.ownerId}` })),
    ),
  ];
  if (all.length === 0) return null;
  const sorted = [...all].sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
  const alineacion = {
    suma_pleno_verificado: building.sumaPlenoVerificado ?? null,
    derechos_verificados: building.derechosVerificados ?? null,
    bloqueos_derechos: building.bloqueosDerechos ?? null,
  };
  return makeCandidate({
    taskCode: "T6",
    subjectType: "building",
    subjectId: building.buildingId,
    buildingId: building.buildingId,
    comercialId: building.comercialId,
    blocking: sorted.some((i) => i.blocking),
    reason: `Incidencias registrales/datos por resolver: ${sorted.length}.`,
    evidence: sorted.flatMap((i) => i.evidence),
    trigger: {
      incidencias: sorted.map((i) => ({
        campo: i.field,
        observado: i.observed,
        esperado: i.expected,
        fuente: i.source,
        accion: i.action,
      })),
      alineacion,
    },
    snapshotExtra: { alineacion, incidencias_count: sorted.length },
  });
}

/**
 * T9: sólo si CADA titular canónico contactable fue realmente contactado,
 * no hay acción/candidato personal y no hay novedad en 90 días.
 */
export function evaluateBuildingT9(
  building: V5BuildingContext,
  personalCandidates: V5Candidate[],
  opts: { now?: Date } = {},
): { candidate: V5Candidate | null; reason: string } {
  const now = opts.now ?? new Date();
  const contactables = building.owners.filter((o) => o.canonical !== false && o.contactable !== false);
  if (contactables.length === 0) return { candidate: null, reason: "Sin titulares canónicos contactables" };

  const blocked = building.owners.filter((o) => identityBlockers(o).length > 0).map((o) => o.ownerId);
  if (blocked.length > 0) {
    return { candidate: null, reason: `T9 no procede: identidad/derechos bloqueados (${blocked.join(", ")})` };
  }
  if (actionableIncidents(building.incidents).length > 0 || building.owners.some((o) => actionableIncidents(o.incidents).length > 0)) {
    return { candidate: null, reason: "T9 no procede: hay incidencias abiertas (T6)" };
  }

  const noContactados = contactables.filter((o) => !o.contactedEver).map((o) => o.ownerId);
  if (noContactados.length > 0) {
    return {
      candidate: null,
      reason: `T9 no procede: titulares contactables sin contactar (${noContactados.join(", ")})`,
    };
  }
  if (personalCandidates.length > 0) {
    return { candidate: null, reason: "T9 no procede: existe candidato personal abierto" };
  }
  if (building.owners.some((o) => o.hasOpenPersonalAction)) {
    return { candidate: null, reason: "T9 no procede: existe acción personal abierta" };
  }
  const noveltyMs = ts(building.lastNoveltyAt);
  if (noveltyMs !== null && now.getTime() - noveltyMs < 90 * DAY_MS) {
    return { candidate: null, reason: "T9 no procede: hay novedad en los últimos 90 días" };
  }
  return {
    candidate: makeCandidate({
      taskCode: "T9",
      subjectType: "building",
      subjectId: building.buildingId,
      buildingId: building.buildingId,
      comercialId: building.comercialId,
      reason: "Todos los titulares contactables ya contactados y sin novedad en 90 días.",
      evidence: contactables.map((o) => ({
        field: "titular_contactado",
        observed: o.lastContactAt ?? true,
        source: `owner:${o.ownerId}`,
      })),
      trigger: {
        titulares: contactables.map((o) => ({ owner_id: o.ownerId, last_contact_at: o.lastContactAt ?? null })).sort((a, b) => (a.owner_id < b.owner_id ? -1 : 1)),
        last_novelty_at: building.lastNoveltyAt ?? null,
      },
    }),
    reason: "T9 elegible",
  };
}

/** Elegibilidad completa de un edificio. */
export function computeEligibility(
  building: V5BuildingContext,
  opts: { now?: Date } = {},
): V5EligibilityResult {
  const candidates: V5Candidate[] = [];
  const notes: V5EligibilityResult["notes"] = [];
  const rejections: V5Rejection[] = [];

  for (const owner of building.owners) {
    const res = evaluateOwner(owner, opts);
    notes.push({ subjectId: owner.ownerId, subjectType: "owner", reason: res.reason });
    if (res.candidate) candidates.push(res.candidate);
  }

  const t6 = evaluateBuildingT6(building);
  if (t6) candidates.push(t6);
  else notes.push({ subjectId: building.buildingId, subjectType: "building", reason: "Sin incidencias accionables para T6" });

  const personal = candidates.filter((c) => c.subjectType === "owner");
  const t9 = evaluateBuildingT9(building, personal, opts);
  if (t9.candidate) candidates.push(t9.candidate);
  else notes.push({ subjectId: building.buildingId, subjectType: "building", reason: t9.reason });

  // T7 nunca produce candidatos.
  rejections.push({
    taskCode: "T7",
    subjectType: "building",
    subjectId: building.buildingId,
    buildingId: building.buildingId,
    reason: "T7 está excluida del motor V5: cero candidatos siempre.",
  });

  return { candidates, rejections, notes };
}