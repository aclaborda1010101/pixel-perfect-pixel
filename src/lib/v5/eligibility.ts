/**
 * MOTOR V5 — FASE A.1. Elegibilidad y precedencia PURAS.
 *
 * Orden obligatorio:
 *   1) T6 / bloqueos del edificio,
 *   2) elegibilidad personal (una sola por propietario),
 *   3) T9 (cierre del edificio).
 * Los modos NUNCA crean candidatos.
 */

import {
  V5_RULES_VERSION,
  buildV5TaskKey,
  fingerprint,
  incidentSignature,
  isAllowedT5Field,
  isConcreteIncident,
  isValidEvidence,
  isTraceableId,
  isValidPastTimestamp,
  type V5BuildingContext,
  type V5Candidate,
  type V5Evidence,
  type V5Incident,
  type V5OwnerContext,
  type V5Rejection,
  type V5Signal,
  type V5T2T3Action,
  type V5TaskCode,
} from "./model";

export type V5EligibilityResult = {
  candidates: V5Candidate[];
  rejections: V5Rejection[];
  notes: { subjectId: string; subjectType: "owner" | "building"; reason: string }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function ts(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function identityBlockers(owner: V5OwnerContext): string[] {
  const id = owner.identity ?? {};
  const out: string[] = [];
  if (id.ambiguousIdentity) out.push("identidad_ambigua");
  if (id.unresolvedDuplicate) out.push("duplicado_no_resuelto");
  if (id.contradictoryRight) out.push("derecho_contradictorio");
  if (id.unreconciledOwner) out.push("propietario_no_conciliado");
  return out;
}

/** Incidencias concretas, deduplicadas por firma completa y ordenadas. */
export function normalizedIncidents(incidents?: V5Incident[] | null): V5Incident[] {
  const seen = new Map<string, V5Incident>();
  for (const inc of incidents ?? []) {
    if (!isConcreteIncident(inc)) continue;
    const sig = incidentSignature(inc);
    if (!seen.has(sig)) seen.set(sig, inc);
  }
  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, inc]) => inc);
}

/**
 * Señal EFECTIVA: resuelve llamadas posteriores contradictorias.
 * Todas las reglas usan esta señal, nunca `owner.lastSignal` directamente.
 */
export function effectiveSignal(owner: V5OwnerContext, opts: { now?: Date } = {}): {
  signal: V5Signal | null;
  contradicted: boolean;
  reason: string;
} {
  const now = opts.now ?? new Date();
  const raw = owner.lastSignal ?? null;
  if (!raw) return { signal: null, contradicted: false, reason: "sin_senal" };
  if (raw.valid === false) return { signal: null, contradicted: false, reason: "senal_invalida" };
  if (!isTraceableId(raw.source)) return { signal: null, contradicted: false, reason: "senal_sin_source" };
  if (!isValidPastTimestamp(raw.at, now)) {
    return { signal: null, contradicted: false, reason: "senal_con_fecha_invalida_o_futura" };
  }
  const signalMs = ts(raw.at);
  const contraMs = ts(owner.contradictingCallAt);
  if (signalMs !== null && contraMs !== null && contraMs > signalMs) {
    return { signal: null, contradicted: true, reason: "llamada_posterior_contradice_senal" };
  }
  return { signal: raw, contradicted: false, reason: "senal_vigente" };
}

function makeCandidate(input: {
  taskCode: V5TaskCode;
  subjectType: "owner" | "building";
  subjectId: string;
  buildingId: string;
  comercialId?: string | null;
  actions?: V5T2T3Action[];
  checkpoints?: string[];
  urgent?: boolean;
  blocking?: boolean;
  suppressedPersonal?: V5Candidate["suppressedPersonal"];
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
    actions: input.actions,
    checkpoints: input.checkpoints,
    urgent: input.urgent ?? false,
    blocking: input.blocking ?? false,
    suppressedPersonal: input.suppressedPersonal,
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

/** Canal válido: teléfono o WhatsApp consentido y autorizado. */
export function hasUsableChannel(owner: V5OwnerContext): boolean {
  const wa = owner.whatsapp ?? {};
  return owner.hasValidPhone === true || (wa.consent === true && wa.authorizedNumber === true);
}

/** Acciones vivas de la familia T2_T3 (una tarjeta, varias acciones). */
export function t2t3Actions(owner: V5OwnerContext, opts: { now?: Date } = {}): V5T2T3Action[] {
  const now = opts.now ?? new Date();
  const wa = owner.whatsapp ?? {};
  const sig = effectiveSignal(owner, { now }).signal;
  const sent = new Set((wa.sentMessageIds ?? []).filter(Boolean) as string[]);
  const actions: V5T2T3Action[] = [];

  if (owner.hasValidPhone === true && owner.callCount === 0) {
    actions.push({
      kind: "primera_llamada",
      reason: "Teléfono válido y cero llamadas registradas.",
      refs: { signalId: sig?.id ?? null },
      evidence: [
        { field: "llamadas", observed: 0, expected: ">0", source: "hubspot", reference: `owner:${owner.ownerId}` },
      ],
    });
  }

  // Registrar consentimiento EXIGE un evento de consentimiento real y trazable.
  if (wa.consentPending === true && wa.consent !== true && isTraceableId(wa.consentEventId)) {
    actions.push({
      kind: "registrar_consentimiento",
      reason: "Falta registrar el consentimiento de WhatsApp.",
      refs: { signalId: sig?.id ?? null, eventId: wa.consentEventId!.trim() },
      evidence: [
        {
          field: "consentimiento_whatsapp",
          observed: wa.consent ?? null,
          expected: true,
          source: "wa_consent_signals",
          reference: wa.consentEventId!.trim(),
        },
      ],
    });
  }

  // Enviar WhatsApp EXIGE pendingMessageId o contentEventId real.
  const pendingId = isTraceableId(wa.pendingMessageId) ? wa.pendingMessageId.trim() : null;
  const contentId = isTraceableId(wa.contentEventId) ? wa.contentEventId.trim() : null;
  const msgRef = pendingId ?? contentId;
  // `wa.sent` global SÓLO suprime como fallback legado explícito y NUNCA
  // tapa un pendingMessageId/contentEventId nuevo.
  const legacySuppression = wa.sent === true && wa.legacySentFallback === true && !msgRef;
  const alreadySent = pendingId !== null && sent.has(pendingId);
  if (
    wa.consent === true &&
    wa.authorizedNumber === true &&
    wa.pendingContentAfterSignal === true &&
    msgRef !== null &&
    !alreadySent &&
    !legacySuppression
  ) {
    actions.push({
      kind: "enviar_whatsapp",
      reason: "Consentimiento válido, número autorizado y contenido pendiente tras la señal.",
      refs: { signalId: sig?.id ?? null, messageId: pendingId, eventId: contentId },
      evidence: [
        {
          field: "contenido_pendiente",
          observed: true,
          source: "wa_conversations",
          reference: msgRef,
          at: isValidPastTimestamp(sig?.at, now) ? sig!.at : null,
        },
      ],
    });
  }

  return actions;
}

/**
 * Precedencia personal ÚNICA y coherente:
 *   bloqueos identidad/derechos > T8 > T1 (sin canal) > T2_T3 > T4 > T5.
 * Máximo UNA recomendación personal por propietario.
 */
export function evaluateOwner(
  owner: V5OwnerContext,
  opts: { now?: Date } = {},
): { candidate: V5Candidate | null; blockers: string[]; reason: string } {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const blockers = identityBlockers(owner);
  const instance = owner.triggerInstanceId ?? null;

  if (blockers.length > 0) {
    return {
      candidate: null,
      blockers,
      reason: `Tareas personales bloqueadas: ${blockers.join(", ")}`,
    };
  }

  const eff = effectiveSignal(owner, { now });
  const signal = eff.signal;

  // --- T8: interés vigente (señal efectiva). Gana a todas las automáticas.
  if (signal?.kind === "interesado") {
    return {
      candidate: makeCandidate({
        taskCode: "T8",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        urgent: true,
        reason: "Señal efectiva = interesado y sin llamada posterior que la contradiga.",
        evidence: [
          {
            field: "senal",
            observed: signal.kind,
            source: signal.source,
            reference: signal.id ?? `owner:${owner.ownerId}`,
            at: signal.at,
          },
        ],
        trigger: {
          signal_id: signal.id ?? null,
          signal_at: signal.at,
          signal_kind: signal.kind,
          source: signal.source,
          instance,
        },
      }),
      blockers,
      reason: "T8 por interés vigente",
    };
  }

  // --- T1: NO hay canal válido -> investigar/verificar datos. NUNCA llamar.
  if (!hasUsableChannel(owner)) {
    return {
      candidate: makeCandidate({
        taskCode: "T1",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        reason: "No hay canal de contacto válido: verificar e investigar datos (no llamar).",
        evidence: [
          {
            field: "canal_contacto",
            observed: null,
            expected: "teléfono válido o WhatsApp autorizado",
            source: "crm",
            reference: `owner:${owner.ownerId}`,
          },
        ],
        trigger: { missing_channel: true, instance },
        snapshotExtra: { accion: "investigar_datos", llamar: false },
      }),
      blockers,
      reason: "T1 por falta de canal válido",
    };
  }

  // --- T2_T3: UNA tarjeta con todas las acciones vivas.
  const actions = t2t3Actions(owner, { now });
  if (actions.length > 0) {
    return {
      candidate: makeCandidate({
        taskCode: "T2_T3",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        actions,
        checkpoints: actions.map((a) => a.kind),
        reason: `Contacto inicial: ${actions.map((a) => a.kind).join(" + ")}.`,
        evidence: actions.flatMap((a) => a.evidence),
        trigger: {
          acciones: actions
            .map((a) => ({ kind: a.kind, refs: a.refs }))
            .sort((a, b) => (a.kind < b.kind ? -1 : 1)),
          instance,
        },
        snapshotExtra: { familia: "T2_T3", acciones: actions.map((a) => a.kind) },
      }),
      blockers,
      reason: "T2_T3 (familia fusionada)",
    };
  }

  // --- T4: cadencia realmente vencida sobre la señal EFECTIVA.
  const dueMs = ts(owner.cadence?.dueAt);
  const cadenceDue = dueMs !== null && dueMs <= nowMs;
  const signalKind: string | undefined = signal?.kind;
  if (cadenceDue && signalKind !== "interesado" && owner.cadence?.channelUsable === true) {
    return {
      candidate: makeCandidate({
        taskCode: "T4",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        reason: "Cadencia vencida, señal efectiva no interesada y canal utilizable.",
        evidence: [
          {
            field: "cadencia_due_at",
            observed: owner.cadence?.dueAt,
            source: "cadence_steps",
            reference: `owner:${owner.ownerId}:cadence`,
          },
        ],
        trigger: {
          cadence_due_at: owner.cadence?.dueAt ?? null,
          senal_efectiva: signal?.kind ?? "ninguna",
          contradicha: eff.contradicted,
          instance,
        },
      }),
      blockers,
      reason: "T4 por cadencia vencida",
    };
  }

  // --- T5: perfilado. Campos deduplicados con Set, mínimo 2 distintos.
  const missing = [...new Set((owner.missingCommercialFields ?? []).filter(isAllowedT5Field))].sort();
  if (owner.contactedEver && missing.length >= 2) {
    return {
      candidate: makeCandidate({
        taskCode: "T5",
        subjectType: "owner",
        subjectId: owner.ownerId,
        buildingId: owner.buildingId,
        comercialId: owner.comercialId,
        reason: `Contacto previo y ${missing.length} campos comerciales distintos pendientes.`,
        evidence: missing.map((f) => ({
          field: f,
          observed: null,
          source: "crm",
          reference: `owner:${owner.ownerId}:${f}`,
        })),
        trigger: { missing_fields: missing, instance },
        snapshotExtra: { campos_permitidos: missing },
      }),
      blockers,
      reason: "T5 por perfilado incompleto",
    };
  }

  return { candidate: null, blockers, reason: "Sin trigger personal elegible" };
}

export type V5T6Result = {
  candidate: V5Candidate | null;
  hardBlocking: boolean;
  incidents: V5Incident[];
  reason: string;
};

/**
 * T6: UNA por edificio. Sólo existe si hay incidencia CONCRETA con evidencia.
 * Los booleanos de identidad/derechos NO inventan T6.
 */
export function evaluateBuildingT6(building: V5BuildingContext): V5T6Result {
  const raw = [
    ...(building.incidents ?? []),
    ...building.owners.flatMap((o) =>
      (o.incidents ?? []).map((inc) => ({ ...inc, source: inc.source || `owner:${o.ownerId}` })),
    ),
  ];
  const incidents = normalizedIncidents(raw);
  if (incidents.length === 0) {
    return { candidate: null, hardBlocking: false, incidents: [], reason: "Sin incidencias concretas con evidencia para T6" };
  }
  const hardBlocking = incidents.some((i) => i.blocking === true);
  const alineacion = {
    suma_pleno_verificado: building.sumaPlenoVerificado ?? null,
    derechos_verificados: building.derechosVerificados ?? null,
    bloqueos_derechos: building.bloqueosDerechos ?? null,
  };
  const candidate = makeCandidate({
    taskCode: "T6",
    subjectType: "building",
    subjectId: building.buildingId,
    buildingId: building.buildingId,
    comercialId: building.comercialId,
    blocking: hardBlocking,
    reason: `Incidencias registrales/datos por resolver: ${incidents.length}.`,
    evidence: incidents.flatMap((i) => i.evidence).filter(isValidEvidence),
    trigger: {
      // Firma CANÓNICA completa: incluye la evidencia (reference/at/quote),
      // de modo que un cambio material sólo en la evidencia cambia el
      // trigger_fingerprint de la T6.
      incidencias: incidents.map((i) => ({
        id: i.id,
        campo: i.field,
        observado: i.observed ?? null,
        esperado: i.expected ?? null,
        fuente: i.source,
        accion: i.action,
        bloqueante: i.blocking === true,
        firma: incidentSignature(i),
      })),
      firma_agrupada: t6GroupSignature(incidents),
      alineacion,
    },
    snapshotExtra: {
      alineacion,
      incidencias_count: incidents.length,
      firma_agrupada: t6GroupSignature(incidents),
    },
  });
  return { candidate, hardBlocking, incidents, reason: hardBlocking ? "T6 bloqueante" : "T6 no bloqueante" };
}

/**
 * T9 ESTRICTA. Todo explícito, nada implícito, `true` no es evidencia.
 */
export function evaluateBuildingT9(
  building: V5BuildingContext,
  personalCandidates: V5Candidate[],
  opts: { now?: Date } = {},
): { candidate: V5Candidate | null; reason: string } {
  const now = opts.now ?? new Date();

  if (building.ownershipUniverseComplete !== true) {
    return { candidate: null, reason: "T9 no procede: universo de titularidad incompleto" };
  }
  const ids = building.owners.map((o) => o.ownerId);
  if (new Set(ids).size !== ids.length) {
    return { candidate: null, reason: "T9 no procede: propietarios duplicados en el universo" };
  }
  if (building.owners.length === 0) {
    return { candidate: null, reason: "T9 no procede: sin titulares" };
  }
  const unknown = building.owners.filter((o) => o.canonical !== true || o.contactable !== true);
  if (unknown.length > 0) {
    return {
      candidate: null,
      reason: `T9 no procede: titulares sin canonical/contactable explícitos (${unknown.map((o) => o.ownerId).join(", ")})`,
    };
  }
  const blocked = building.owners.filter((o) => identityBlockers(o).length > 0).map((o) => o.ownerId);
  if (blocked.length > 0) {
    return { candidate: null, reason: `T9 no procede: identidad/derechos bloqueados (${blocked.join(", ")})` };
  }
  const t6 = evaluateBuildingT6(building);
  if (t6.candidate) {
    return { candidate: null, reason: "T9 no procede: hay incidencias abiertas (T6)" };
  }
  const sinEvento = building.owners.filter(
    (o) =>
      o.contactedEver !== true ||
      !o.lastContact ||
      ts(o.lastContact.at) === null ||
      !o.lastContact.source ||
      !o.lastContact.eventId,
  );
  if (sinEvento.length > 0) {
    return {
      candidate: null,
      reason: `T9 no procede: titulares sin evento de contacto real (${sinEvento.map((o) => o.ownerId).join(", ")})`,
    };
  }
  if (personalCandidates.length > 0) {
    return { candidate: null, reason: "T9 no procede: existe candidato personal abierto" };
  }
  if (building.owners.some((o) => o.hasOpenPersonalAction)) {
    return { candidate: null, reason: "T9 no procede: existe acción personal abierta" };
  }
  const noveltyMs = ts(building.lastNoveltyAt);
  if (noveltyMs === null) {
    return { candidate: null, reason: "T9 no procede: última novedad ausente o inválida" };
  }
  if (now.getTime() - noveltyMs < 90 * DAY_MS) {
    return { candidate: null, reason: "T9 no procede: hay novedad en los últimos 90 días" };
  }

  const titulares = building.owners
    .map((o) => ({
      owner_id: o.ownerId,
      contacto_at: o.lastContact!.at,
      fuente: o.lastContact!.source,
      evento: o.lastContact!.eventId,
    }))
    .sort((a, b) => (a.owner_id < b.owner_id ? -1 : 1));

  return {
    candidate: makeCandidate({
      taskCode: "T9",
      subjectType: "building",
      subjectId: building.buildingId,
      buildingId: building.buildingId,
      comercialId: building.comercialId,
      reason: "Universo completo, todos los titulares contactados con evento real y sin novedad en 90 días.",
      evidence: building.owners.map((o) => ({
        field: "titular_contactado",
        observed: o.lastContact!.at,
        source: o.lastContact!.source,
        reference: o.lastContact!.eventId,
        at: o.lastContact!.at,
      })),
      trigger: { titulares, last_novelty_at: building.lastNoveltyAt },
    }),
    reason: "T9 elegible",
  };
}

/** Elegibilidad completa de un edificio. T6 SIEMPRE se calcula primero. */
export function computeEligibility(
  building: V5BuildingContext,
  opts: { now?: Date } = {},
): V5EligibilityResult {
  const candidates: V5Candidate[] = [];
  const notes: V5EligibilityResult["notes"] = [];
  const rejections: V5Rejection[] = [];

  const t6 = evaluateBuildingT6(building);

  // Evaluación personal (siempre se calcula para poder trazar supresiones).
  const personalEvals = building.owners.map((o) => ({ owner: o, res: evaluateOwner(o, opts) }));

  if (t6.candidate && t6.hardBlocking) {
    const suppressed = personalEvals.map(({ owner, res }) => ({
      subjectId: owner.ownerId,
      taskCode: (res.candidate?.taskCode ?? "ninguna") as V5TaskCode | "ninguna",
      reason: res.candidate ? "suprimida por T6 bloqueante" : res.reason,
    }));
    const only: V5Candidate = {
      ...t6.candidate,
      suppressedPersonal: suppressed,
      eligibilitySnapshot: { ...t6.candidate.eligibilitySnapshot, suprimidas: suppressed },
    };
    notes.push({
      subjectId: building.buildingId,
      subjectType: "building",
      reason: `T6 bloqueante: se suprimen ${suppressed.filter((s) => s.taskCode !== "ninguna").length} tareas personales`,
    });
    for (const s of suppressed) {
      notes.push({ subjectId: s.subjectId, subjectType: "owner", reason: s.reason });
    }
    rejections.push({
      taskCode: "T7",
      subjectType: "building",
      subjectId: building.buildingId,
      buildingId: building.buildingId,
      reason: "T7 está excluida del motor V5: cero candidatos siempre.",
    });
    return { candidates: [only], rejections, notes };
  }

  for (const { owner, res } of personalEvals) {
    notes.push({ subjectId: owner.ownerId, subjectType: "owner", reason: res.reason });
    if (res.candidate) candidates.push(res.candidate);
  }

  if (t6.candidate) {
    const coexiste = t6.incidents.every((i) => i.coexistsWithPersonal === true);
    const personalCount = candidates.length;
    if (personalCount === 0 || coexiste) {
      const justificacion = personalCount === 0
        ? "T6 no bloqueante sin tareas personales elegibles"
        : `Coexistencia declarada: ${t6.incidents.map((i) => i.coexistenceRule ?? i.id).join(", ")}`;
      candidates.push({
        ...t6.candidate,
        eligibilitySnapshot: { ...t6.candidate.eligibilitySnapshot, coexistencia: justificacion },
      });
    } else {
      notes.push({
        subjectId: building.buildingId,
        subjectType: "building",
        reason: "T6 no bloqueante omitida: la regla no declara coexistencia con tareas personales",
      });
    }
  } else {
    notes.push({ subjectId: building.buildingId, subjectType: "building", reason: t6.reason });
  }

  const personal = candidates.filter((c) => c.subjectType === "owner");
  const t9 = evaluateBuildingT9(building, personal, opts);
  if (t9.candidate) candidates.push(t9.candidate);
  else notes.push({ subjectId: building.buildingId, subjectType: "building", reason: t9.reason });

  rejections.push({
    taskCode: "T7",
    subjectType: "building",
    subjectId: building.buildingId,
    buildingId: building.buildingId,
    reason: "T7 está excluida del motor V5: cero candidatos siempre.",
  });

  return { candidates, rejections, notes };
}
