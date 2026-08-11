import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  computeEligibility,
  effectiveSignal,
  evaluateBuildingT6,
  evaluateBuildingT9,
  evaluateOwner,
} from "@/lib/v5/eligibility";
import {
  buildV5TaskKey,
  V5_RULES_VERSION,
  V5_GENERATION_MODES,
  isValidEvidence,
  type V5BuildingContext,
  type V5Candidate,
  type V5Evidence,
  type V5Incident,
  type V5OwnerContext,
} from "@/lib/v5/model";
import { revalidateOpenTasks, type V5TerminalRecord } from "@/lib/v5/revalidate";
import {
  isModeActivatable,
  selectNextByMode,
  validateMix,
  V5_PREDEFINED_MODES,
  type V5ModeConfig,
  type V5WindowEntry,
} from "@/lib/v5/modes";
import {
  buildDemoProposals,
  assertPersistableGenerationMode,
  planRecomputeDeletions,
  validateManualDraft,
} from "@/lib/v5/manualDemo";
import {
  V5_TASK_STATUSES,
  assertV5TaskStatus,
  countOccupiedSlots,
  isOpenStatus,
  isTerminalStatus,
  isV5TaskStatus,
  occupiesAutomaticSlot,
} from "@/lib/v5/status";
import { canReopenTask, decideTaskReopen, decideTaskStart } from "@/lib/taskStart";
import { FEATURE_V5_ENGINE_PHASE_A } from "@/lib/featureFlags";

const NOW = new Date("2026-08-11T10:00:00Z");
const TOMORROW = new Date("2026-08-12T10:00:00Z");

/** Mezcla de prueba: los modos reales no traen pesos inventados. */
const MIX = { T1: 15, T2_T3: 45, T4: 10, T5: 10, T6: 10, T8: 10, T9: 0 };
const CFG: V5ModeConfig = { global: { mode: "iniciar_conversaciones", mix: MIX } };

function ev(partial: Partial<V5Evidence> = {}): V5Evidence {
  return { field: "campo", observed: 1, source: "nota_simple", reference: "nota:1#p1", ...partial };
}

function incident(partial: Partial<V5Incident> & { id: string }): V5Incident {
  return {
    field: "suma_pleno_verificado",
    observed: 82,
    expected: 100,
    source: "nota_simple",
    action: "Revisar titularidad registral",
    evidence: [ev({ field: "suma_pleno_verificado", observed: 82, reference: "nota:123#p2" })],
    ...partial,
  };
}

function owner(partial: Partial<V5OwnerContext> & { ownerId: string }): V5OwnerContext {
  return {
    buildingId: "B1",
    comercialId: "C1",
    hasValidPhone: true,
    callCount: 3,
    contactedEver: true,
    ...partial,
  };
}

function building(partial: Partial<V5BuildingContext> = {}): V5BuildingContext {
  return { buildingId: "B1", comercialId: "C1", owners: [], ...partial };
}

function fakeCandidate(code: string, id: string, extra: Partial<V5Candidate> = {}): V5Candidate {
  return {
    taskCode: code as V5Candidate["taskCode"],
    subjectType: "owner",
    subjectId: id,
    buildingId: "B1",
    comercialId: "C1",
    reason: "test",
    evidence: [],
    eligibilitySnapshot: {},
    triggerFingerprint: `fp-${id}`,
    taskKey: `v5:${V5_RULES_VERSION}:${code}:B1:${id}:fp-${id}`,
    rulesVersion: V5_RULES_VERSION,
    ...extra,
  };
}

describe("V5 fase A.1 — flag", () => {
  it("sigue desactivado", () => {
    expect(FEATURE_V5_ENGINE_PHASE_A).toBe(false);
  });
});

// =====================================================================
// 2) T6 / bloqueos sin contradicciones
// =====================================================================
describe("V5 T6 y bloqueos", () => {
  it("T6 hard + propietario sin llamadas => SÓLO T6 y registra las suprimidas", () => {
    const o = owner({ ownerId: "O1", callCount: 0, contactedEver: false });
    const res = computeEligibility(
      building({ owners: [o], incidents: [incident({ id: "inc-1", blocking: true })] }),
      { now: NOW },
    );
    expect(res.candidates.map((c) => c.taskCode)).toEqual(["T6"]);
    const t6 = res.candidates[0];
    expect(t6.blocking).toBe(true);
    expect(t6.suppressedPersonal).toEqual([
      { subjectId: "O1", taskCode: "T2_T3", reason: "suprimida por T6 bloqueante" },
    ]);
  });

  it("bloqueo booleano sin incidencia concreta => 0 personales y 0 T6 inventada", () => {
    const o = owner({ ownerId: "O1", callCount: 0, identity: { ambiguousIdentity: true } });
    const res = computeEligibility(building({ owners: [o] }), { now: NOW });
    expect(res.candidates).toHaveLength(0);
    expect(res.notes.some((n) => n.reason.includes("bloqueadas"))).toBe(true);
  });

  it("incidencia sin evidencia válida se rechaza (no genera T6)", () => {
    const sinEvidencia = incident({ id: "inc-x", evidence: [] });
    const evidenciaIncompleta = incident({
      id: "inc-y",
      evidence: [{ field: "x", observed: 1, source: "nota", reference: "" }],
    });
    expect(evaluateBuildingT6(building({ incidents: [sinEvidencia] })).candidate).toBeNull();
    expect(evaluateBuildingT6(building({ incidents: [evidenciaIncompleta] })).candidate).toBeNull();
    expect(isValidEvidence({ field: "x", observed: 1, source: "nota" })).toBe(false);
  });

  it("permutar propietarios e incidencias no cambia el fingerprint; duplicados se deduplican", () => {
    const a = incident({ id: "inc-a", blocking: true });
    const b = incident({ id: "inc-b", field: "titular", action: "Conciliar titular" });
    const o1 = owner({ ownerId: "O1", incidents: [a] });
    const o2 = owner({ ownerId: "O2", incidents: [b, { ...b }] });
    const one = evaluateBuildingT6(building({ owners: [o1, o2] })).candidate!;
    const two = evaluateBuildingT6(building({ owners: [o2, o1] })).candidate!;
    expect(one.triggerFingerprint).toBe(two.triggerFingerprint);
    expect(one.eligibilitySnapshot.incidencias_count).toBe(2);
  });

  it("T6 no bloqueante sólo coexiste con personales si la regla lo declara", () => {
    const o = owner({ ownerId: "O1", callCount: 0, contactedEver: false });
    const inc = incident({ id: "inc-1", blocking: false });
    const sin = computeEligibility(building({ owners: [o], incidents: [inc] }), { now: NOW });
    expect(sin.candidates.map((c) => c.taskCode)).toEqual(["T2_T3"]);

    const con = computeEligibility(
      building({ owners: [o], incidents: [{ ...inc, coexistsWithPersonal: true, coexistenceRule: "R-COEX-1" }] }),
      { now: NOW },
    );
    expect(con.candidates.map((c) => c.taskCode).sort()).toEqual(["T2_T3", "T6"]);
    expect(String(con.candidates.find((c) => c.taskCode === "T6")!.eligibilitySnapshot.coexistencia)).toContain("R-COEX-1");
  });
});

// =====================================================================
// 3) Precedencia y T2_T3 fusionada
// =====================================================================
describe("V5 precedencia y señal efectiva", () => {
  it("señal interesada + llamada posterior contradictoria + cadencia vencida => T4, no T8", () => {
    const o = owner({
      ownerId: "O1",
      lastSignal: { id: "sig-1", kind: "interesado", at: "2026-08-01T00:00:00Z", source: "call" },
      contradictingCallAt: "2026-08-05T00:00:00Z",
      cadence: { dueAt: "2026-08-07T00:00:00Z", channelUsable: true },
    });
    expect(effectiveSignal(o).contradicted).toBe(true);
    const res = evaluateOwner(o, { now: NOW });
    expect(res.candidate?.taskCode).toBe("T4");
  });

  it("interesado vigente => T8 urgente por encima de todo", () => {
    const res = evaluateOwner(
      owner({
        ownerId: "O1",
        lastSignal: { id: "sig-9", kind: "interesado", at: "2026-08-01T00:00:00Z", source: "call" },
        cadence: { dueAt: "2026-01-01T00:00:00Z", channelUsable: true },
        missingCommercialFields: ["motivacion", "urgencia"],
      }),
      { now: NOW },
    );
    expect(res.candidate?.taskCode).toBe("T8");
    expect(res.candidate?.urgent).toBe(true);
  });

  it("T1 sólo sin canal válido y nunca 'llamar'", () => {
    const sinCanal = evaluateOwner(owner({ ownerId: "O2", hasValidPhone: false, callCount: 0 }), { now: NOW });
    expect(sinCanal.candidate?.taskCode).toBe("T1");
    expect(sinCanal.candidate?.eligibilitySnapshot.llamar).toBe(false);

    const conWhatsapp = evaluateOwner(
      owner({
        ownerId: "O3",
        hasValidPhone: false,
        callCount: 2,
        whatsapp: { consent: true, authorizedNumber: true, pendingContentAfterSignal: true, pendingMessageId: "msg-1" },
      }),
      { now: NOW },
    );
    expect(conWhatsapp.candidate?.taskCode).toBe("T2_T3");
  });

  it("T2_T3 es UNA tarjeta con varias acciones que conviven", () => {
    const res = evaluateOwner(
      owner({
        ownerId: "O4",
        callCount: 0,
        whatsapp: {
          consent: true,
          authorizedNumber: true,
          consentPending: false,
          pendingContentAfterSignal: true,
          pendingMessageId: "msg-7",
        },
      }),
      { now: NOW },
    );
    const c = res.candidate!;
    expect(c.taskCode).toBe("T2_T3");
    expect(c.actions?.map((a) => a.kind).sort()).toEqual(["enviar_whatsapp", "primera_llamada"]);
    expect(c.taskKey).toContain(":T2_T3:");
    expect(c.taskKey).not.toContain(":T3:");
    expect(JSON.stringify(c.actions)).toContain("msg-7");
  });

  it("acción ya resuelta (WhatsApp enviado para ese message_id) no se genera", () => {
    const res = evaluateOwner(
      owner({
        ownerId: "O5",
        callCount: 0,
        whatsapp: {
          consent: true,
          authorizedNumber: true,
          pendingContentAfterSignal: true,
          pendingMessageId: "msg-7",
          sentMessageIds: ["msg-7"],
        },
      }),
      { now: NOW },
    );
    expect(res.candidate?.actions?.map((a) => a.kind)).toEqual(["primera_llamada"]);
  });

  it("registrar consentimiento y primera llamada conviven en la misma tarjeta", () => {
    const res = evaluateOwner(
      owner({ ownerId: "O6", callCount: 0, whatsapp: { consentPending: true, consentEventId: "cev-2" } }),
      { now: NOW },
    );
    expect(res.candidate?.checkpoints).toEqual(["primera_llamada", "registrar_consentimiento"]);
  });

  it("T5 deduplica campos con Set y exige 2 distintos; nunca cuota/%/derecho", () => {
    const dup = evaluateOwner(
      owner({ ownerId: "O7", missingCommercialFields: ["motivacion", "motivacion"] }),
      { now: NOW },
    );
    expect(dup.candidate).toBeNull();

    const ok = evaluateOwner(
      owner({
        ownerId: "O8",
        missingCommercialFields: ["cuota", "porcentaje_pleno", "derecho_registral", "urgencia", "motivacion", "motivacion"],
      }),
      { now: NOW },
    );
    expect(ok.candidate?.taskCode).toBe("T5");
    expect(ok.candidate?.eligibilitySnapshot.campos_permitidos).toEqual(["motivacion", "urgencia"]);
    expect(JSON.stringify(ok.candidate)).not.toMatch(/cuota|porcentaj|derecho/i);
  });

  it("cada par de precedencia se resuelve igual siempre", () => {
    const pares: [Partial<V5OwnerContext>, string][] = [
      [{ hasValidPhone: false, lastSignal: { kind: "interesado", at: "2026-08-01T00:00:00Z", source: "call" } }, "T8"],
      [{ hasValidPhone: false, callCount: 0, cadence: { dueAt: "2026-01-01T00:00:00Z", channelUsable: true } }, "T1"],
      [{ callCount: 0, cadence: { dueAt: "2026-01-01T00:00:00Z", channelUsable: true } }, "T2_T3"],
      [
        {
          callCount: 4,
          cadence: { dueAt: "2026-01-01T00:00:00Z", channelUsable: true },
          missingCommercialFields: ["motivacion", "urgencia"],
        },
        "T4",
      ],
      [{ callCount: 4, missingCommercialFields: ["motivacion", "urgencia"] }, "T5"],
    ];
    for (const [ctx, code] of pares) {
      expect(evaluateOwner(owner({ ownerId: "P", ...ctx }), { now: NOW }).candidate?.taskCode).toBe(code);
    }
  });

  it("T7 nunca existe: ni candidato ni clave", () => {
    const res = computeEligibility(building({ owners: [owner({ ownerId: "A", callCount: 0 })] }), { now: NOW });
    expect(res.candidates.some((c) => (c.taskCode as string) === "T7")).toBe(false);
    expect(res.rejections.some((r) => r.taskCode === "T7")).toBe(true);
    expect(() =>
      buildV5TaskKey({ taskCode: "T7" as never, buildingId: "B1", subjectId: "A", triggerFingerprint: "x" }),
    ).toThrow();
  });
});

// =====================================================================
// 4) Revalidación y tombstones
// =====================================================================
describe("V5 revalidación y tombstones", () => {
  const openFrom = (c: V5Candidate) => ({
    taskKey: c.taskKey,
    taskCode: c.taskCode,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    buildingId: c.buildingId,
    triggerFingerprint: c.triggerFingerprint,
  });

  it("ida y vuelta de teléfono: el fingerprint resuelto no reaparece; un evento nuevo sí", () => {
    const sinTel = owner({ ownerId: "O1", hasValidPhone: false, callCount: 0, triggerInstanceId: "inst-1" });
    const t1 = evaluateOwner(sinTel, { now: NOW }).candidate!;
    const historia: V5TerminalRecord[] = [
      {
        taskKey: t1.taskKey,
        taskCode: "T1",
        subjectId: "O1",
        triggerFingerprint: t1.triggerFingerprint,
        outcome: "completed",
        resolvedAt: NOW.toISOString(),
      },
    ];
    const mismoEvento = revalidateOpenTasks(building({ owners: [sinTel] }), [], { now: TOMORROW, history: historia });
    expect(mismoEvento.fresh).toHaveLength(0);
    expect(mismoEvento.suppressed[0].reason).toBe("fingerprint_ya_resuelto");

    const nuevoEvento = owner({ ...sinTel, triggerInstanceId: "inst-2" });
    const conNuevo = revalidateOpenTasks(building({ owners: [nuevoEvento] }), [], { now: TOMORROW, history: historia });
    expect(conNuevo.fresh.map((c) => c.taskCode)).toEqual(["T1"]);
  });

  it("trigger idéntico y tarea abierta => valid", () => {
    const o = owner({ ownerId: "O2", hasValidPhone: false, callCount: 0 });
    const t1 = evaluateOwner(o, { now: NOW }).candidate!;
    const res = revalidateOpenTasks(building({ owners: [o] }), [openFrom(t1)], { now: TOMORROW });
    expect(res.valid).toHaveLength(1);
    expect(res.superseded).toHaveLength(0);
  });

  it("T5 de 3 a 2 campos se actualiza en sitio, no se marca resuelto", () => {
    const antes = owner({ ownerId: "O3", missingCommercialFields: ["motivacion", "urgencia", "decisores"] });
    const t5 = evaluateOwner(antes, { now: NOW }).candidate!;
    const despues = owner({ ownerId: "O3", missingCommercialFields: ["motivacion", "urgencia"] });
    const res = revalidateOpenTasks(building({ owners: [despues] }), [openFrom(t5)], { now: NOW });
    expect(res.superseded).toHaveLength(0);
    expect(res.updated).toHaveLength(1);
    expect(res.updated[0].candidate.taskCode).toBe("T5");
  });

  it("añadir una incidencia a T6 no la marca resuelta", () => {
    const inc = incident({ id: "inc-1" });
    const t6 = evaluateBuildingT6(building({ incidents: [inc] })).candidate!;
    const res = revalidateOpenTasks(
      building({ incidents: [inc, incident({ id: "inc-2", field: "titular", action: "Conciliar" })] }),
      [openFrom(t6)],
      { now: NOW },
    );
    expect(res.superseded).toHaveLength(0);
    expect(res.updated[0].changeReason).toContain("no se marca resuelto");
  });

  it("cambio de código => supersede con reemplazo", () => {
    const sinTel = owner({ ownerId: "O4", hasValidPhone: false, callCount: 0 });
    const t1 = evaluateOwner(sinTel, { now: NOW }).candidate!;
    const conTel = owner({ ownerId: "O4", hasValidPhone: true, callCount: 0 });
    const res = revalidateOpenTasks(building({ owners: [conTel] }), [openFrom(t1)], { now: NOW });
    expect(res.superseded[0].supersededReason).toBe("t1_canal_ya_disponible");
    expect(res.superseded[0].replacement?.taskCode).toBe("T2_T3");
  });

  it("cooldown activo suprime el candidato", () => {
    const o = owner({ ownerId: "O5", hasValidPhone: false, callCount: 0 });
    const res = revalidateOpenTasks(building({ owners: [o] }), [], {
      now: NOW,
      history: [
        {
          taskKey: "x",
          taskCode: "T1",
          subjectId: "O5",
          triggerFingerprint: "otro",
          outcome: "superseded",
          resolvedAt: NOW.toISOString(),
          cooldownUntil: "2026-09-01T00:00:00Z",
        },
      ],
    });
    expect(res.fresh).toHaveLength(0);
    expect(res.suppressed[0].reason).toContain("cooldown_activo");
  });
});

// =====================================================================
// 5) T9 estricta
// =====================================================================
describe("V5 T9 estricta", () => {
  const contactado = (id: string, at: string) =>
    owner({
      ownerId: id,
      canonical: true,
      contactable: true,
      contactedEver: true,
      lastContact: { at, source: "hubspot", eventId: `call-${id}` },
      missingCommercialFields: [],
    });

  const base = (owners: V5OwnerContext[], extra: Partial<V5BuildingContext> = {}) =>
    building({ owners, ownershipUniverseComplete: true, lastNoveltyAt: "2025-03-01T00:00:00Z", ...extra });

  it("elegible con universo completo, eventos reales y 90 días sin novedad", () => {
    const res = evaluateBuildingT9(
      base([contactado("A", "2025-01-01T00:00:00Z"), contactado("B", "2025-02-01T00:00:00Z")]),
      [],
      { now: NOW },
    );
    expect(res.candidate?.taskCode).toBe("T9");
    expect(res.candidate?.evidence.every(isValidEvidence)).toBe(true);
  });

  it("universo incompleto bloquea", () => {
    const res = evaluateBuildingT9(
      building({ owners: [contactado("A", "2025-01-01T00:00:00Z")], lastNoveltyAt: "2025-03-01T00:00:00Z" }),
      [],
      { now: NOW },
    );
    expect(res.candidate).toBeNull();
    expect(res.reason).toContain("universo");
  });

  it("canonical/contactable desconocidos bloquean", () => {
    const o = { ...contactado("A", "2025-01-01T00:00:00Z"), canonical: undefined };
    const res = evaluateBuildingT9(base([o]), [], { now: NOW });
    expect(res.candidate).toBeNull();
    expect(res.reason).toContain("canonical");
  });

  it("propietario duplicado bloquea", () => {
    const a = contactado("A", "2025-01-01T00:00:00Z");
    const res = evaluateBuildingT9(base([a, { ...a }]), [], { now: NOW });
    expect(res.reason).toContain("duplicados");
  });

  it("contacto sin evento real (true como evidencia) bloquea", () => {
    const o = { ...contactado("A", "2025-01-01T00:00:00Z"), lastContact: null };
    const res = evaluateBuildingT9(base([o]), [], { now: NOW });
    expect(res.reason).toContain("evento de contacto real");
  });

  it("lastNoveltyAt nula o inválida bloquea", () => {
    const o = contactado("A", "2025-01-01T00:00:00Z");
    expect(evaluateBuildingT9(base([o], { lastNoveltyAt: null }), [], { now: NOW }).reason).toContain("novedad ausente");
    expect(evaluateBuildingT9(base([o], { lastNoveltyAt: "no-fecha" }), [], { now: NOW }).reason).toContain("novedad ausente");
    expect(evaluateBuildingT9(base([o], { lastNoveltyAt: "2026-08-01T00:00:00Z" }), [], { now: NOW }).reason).toContain("90 días");
  });

  it("incidencia, bloqueo de identidad o acción personal bloquean", () => {
    const o = contactado("A", "2025-01-01T00:00:00Z");
    expect(evaluateBuildingT9(base([o], { incidents: [incident({ id: "i1" })] }), [], { now: NOW }).candidate).toBeNull();
    expect(
      evaluateBuildingT9(base([{ ...o, identity: { unresolvedDuplicate: true } }]), [], { now: NOW }).candidate,
    ).toBeNull();
    expect(evaluateBuildingT9(base([{ ...o, hasOpenPersonalAction: true }]), [], { now: NOW }).candidate).toBeNull();
    expect(evaluateBuildingT9(base([o]), [fakeCandidate("T4", "A")], { now: NOW }).candidate).toBeNull();
  });
});

// =====================================================================
// 6) Modos y generación continua
// =====================================================================
describe("V5 modos", () => {
  it("los modos predefinidos existen pero no son activables sin pesos guardados", () => {
    expect(Object.keys(V5_PREDEFINED_MODES).sort()).toEqual(["equilibrado", "iniciar_conversaciones", "seguimiento"]);
    for (const [, def] of Object.entries(V5_PREDEFINED_MODES)) expect(def.mix).toBeNull();
    const check = isModeActivatable("equilibrado", null);
    expect(check.activatable).toBe(false);
    expect(check.errors.join()).toContain("Carlos");
    // Manual tampoco se activa sin mapa completo: también genera automáticas.
    expect(isModeActivatable("manual", null).activatable).toBe(false);
    expect(isModeActivatable("manual", MIX).activatable).toBe(true);
  });

  it("validación exacta de buckets", () => {
    expect(validateMix(MIX).valid).toBe(true);
    expect(validateMix({ ...MIX, T7: 0 }).errors.join()).toContain("T7");
    expect(validateMix({ ...MIX, TX: 0 }).errors.join()).toContain("desconocido");
    const { T9: _omit, ...sinT9 } = MIX;
    expect(validateMix(sinT9).errors.join()).toContain("Falta el bucket T9");
    expect(validateMix({ ...MIX, T4: 10.5 }).valid).toBe(false);
    expect(validateMix({ ...MIX, T4: 11 }).errors.join()).toContain("exactamente 100");
  });

  it("modo manual: cero automáticas", () => {
    const res = selectNextByMode({
      comercialId: "C1",
      candidates: [fakeCandidate("T4", "O1")],
      config: { global: { mode: "manual" } },
    });
    expect(res.selected).toBeNull();
    expect(res.modeSnapshot.automaticas).toBe(0);
  });

  it("override de comercial gana al global y queda en el snapshot", () => {
    const config: V5ModeConfig = {
      global: { mode: "seguimiento", mix: MIX },
      overrides: { C1: { mode: "manual" } },
    };
    expect(selectNextByMode({ comercialId: "C1", candidates: [fakeCandidate("T4", "O1")], config }).modeSnapshot.source).toBe("override");
    expect(selectNextByMode({ comercialId: "C2", candidates: [], config }).modeSnapshot.source).toBe("global");
  });

  it("Jesús nunca recibe un candidato de David ni uno sin comercial", () => {
    const ajenos = [
      fakeCandidate("T4", "D1", { comercialId: "david" }),
      fakeCandidate("T4", "N1", { comercialId: null }),
    ];
    const res = selectNextByMode({ comercialId: "jesus", candidates: ajenos, config: CFG });
    expect(res.selected).toBeNull();
    expect(res.rejected).toHaveLength(2);
    expect(res.rejected.map((r) => r.reason).join()).toContain("≠ jesus");
  });

  it("urgente gana una vez y queda justificado en modeSnapshot", () => {
    const res = selectNextByMode({
      comercialId: "C1",
      candidates: [fakeCandidate("T4", "O1"), fakeCandidate("T8", "O2", { urgent: true })],
      config: CFG,
    });
    expect(res.selected?.taskCode).toBe("T8");
    expect(res.modeSnapshot.urgente).toBeTruthy();
    const segunda = selectNextByMode({
      comercialId: "C1",
      candidates: [fakeCandidate("T4", "O1"), fakeCandidate("T8", "O2", { urgent: true })],
      config: CFG,
      window: res.window,
    });
    expect(segunda.selected?.taskCode).toBe("T4");
  });

  it("25 invocaciones producen una a una con ventana móvil de 20 y sin repetir", () => {
    const pool = Array.from({ length: 30 }, (_, i) => fakeCandidate("T2_T3", `O${String(i).padStart(2, "0")}`));
    let window: V5WindowEntry[] = [];
    const keys: string[] = [];
    const emitidas = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const step = selectNextByMode({
        comercialId: "C1",
        candidates: pool.filter((c) => !emitidas.has(c.taskKey)),
        config: CFG,
        window,
      });
      expect(step.selected).not.toBeNull();
      keys.push(step.selected!.taskKey);
      emitidas.add(step.selected!.taskKey);
      window = step.window;
      expect(window.length).toBeLessThanOrEqual(20);
    }
    expect(new Set(keys).size).toBe(25);
    expect(window).toHaveLength(20);
    expect(window[0].taskKey).toBe(keys[24]);
    // El más antiguo fue expulsado.
    expect(window.some((w) => w.taskKey === keys[0])).toBe(false);
  });

  it("dedupe por task_key: un candidato ya en ventana no se repite", () => {
    const c = fakeCandidate("T2_T3", "O1");
    const res = selectNextByMode({
      comercialId: "C1",
      candidates: [c],
      config: CFG,
      window: [{ taskKey: c.taskKey, bucket: c.taskCode }],
    });
    expect(res.selected).toBeNull();
    expect(res.rejected[0].reason).toBe("duplicado por task_key");
  });
});

// =====================================================================
// Manual y demo
// =====================================================================
describe("V5 manual y demo", () => {
  it("manual válido exige sujeto, autor y ventana exacta", () => {
    const ok = validateManualDraft({
      buildingId: "B1",
      subjectType: "owner",
      subjectId: "O1",
      title: "Posible interés",
      manualSubtype: "posible_interes",
      startsAt: "2026-08-11T09:00:00Z",
      dueDate: "2026-08-15T09:00:00Z",
      createdBy: "U1",
    });
    expect(ok.valid).toBe(true);
    expect(ok.draft?.generationMode).toBe("manual");

    const sinAutor = validateManualDraft({
      buildingId: "B1",
      subjectType: "cosa" as never,
      subjectId: "O1",
      title: "X",
      manualSubtype: "posible_interes",
      startsAt: "2026-08-15T09:00:00Z",
      dueDate: "2026-08-11T09:00:00Z",
    });
    expect(sinAutor.valid).toBe(false);
    expect(sinAutor.errors.join()).toContain("created_by");
    expect(sinAutor.errors.join()).toContain("Tipo de sujeto");
    expect(sinAutor.errors.join()).toContain("anterior");
  });

  it("el recompute nunca retira manuales ni legacy", () => {
    const plan = planRecomputeDeletions([
      { taskKey: "a", generationMode: "manual" },
      { taskKey: "b", generationMode: "production" },
      { taskKey: "c", generationMode: "legacy" },
      { taskKey: "d", generationMode: "production" },
    ]);
    expect(plan.protectedTasks.map((t) => t.taskKey).sort()).toEqual(["a", "c"]);
    expect(plan.deletable.map((t) => t.taskKey).sort()).toEqual(["b", "d"]);
  });

  it("demo tope 20, iterando selectNextByMode y sin escrituras (repo falso espiado)", () => {
    const repo = { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), upsert: vi.fn() };
    const buildings = Array.from({ length: 40 }, (_, i) =>
      building({
        buildingId: `B${i}`,
        owners: [owner({ ownerId: `O${i}`, buildingId: `B${i}`, callCount: 0, contactedEver: false })],
      }),
    );
    const res = buildDemoProposals({ comercialId: "C1", buildings, config: CFG, now: NOW });
    expect(res.proposals).toHaveLength(20);
    expect(res.report).toBe("20/20");
    expect(res.shortfall).toBe(0);
    expect(res.writes).toBe(0);
    expect(res.persisted).toBe(false);
    // La demo NO compite por task_key: es un DTO de preview.
    expect(new Set(res.proposals.map((p) => p.previewKey)).size).toBe(20);
    for (const p of res.proposals) {
      expect((p as Record<string, unknown>).taskKey).toBeUndefined();
      expect(p.generationMode).toBe("demo");
      expect(p.persistable).toBe(false);
    }
    for (const spy of Object.values(repo)) expect(spy).not.toHaveBeenCalled();
  });

  it("demo reporta X/20 cuando no hay suficientes", () => {
    const res = buildDemoProposals({
      comercialId: "C1",
      buildings: [building({ owners: [owner({ ownerId: "O1", callCount: 0, contactedEver: false })] })],
      config: CFG,
      now: NOW,
    });
    expect(res.report).toBe("1/20");
    expect(res.shortfall).toBe(19);
    expect(res.writes).toBe(0);
  });

  it("demo nunca es persistible: generation_mode='demo' se rechaza en código", () => {
    expect(() => assertPersistableGenerationMode("demo")).toThrow(/no es persistible/);
    expect(() => assertPersistableGenerationMode("queued")).toThrow(/no persistible/);
    expect(V5_GENERATION_MODES as readonly string[]).not.toContain("demo");
    for (const m of ["legacy", "production", "manual"]) {
      expect(assertPersistableGenerationMode(m)).toBe(m);
    }
  });

  it("manual es tarea real e iniciable; legacy no se interpreta como manual", () => {
    expect(decideTaskStart({ status: "pending", generation_mode: "manual" }).action).toBe("start");
    expect(decideTaskStart({ status: "pending", generation_mode: "legacy" })).toMatchObject({
      action: "reject", reason: "modo_no_iniciable",
    });
    expect(decideTaskStart({ status: "pending", generation_mode: "demo" })).toMatchObject({
      action: "reject", reason: "modo_no_iniciable",
    });
    expect(decideTaskStart({ status: "blocked", generation_mode: "manual" })).toMatchObject({
      action: "reject", reason: "estado_no_iniciable",
    });
  });
});

// =====================================================================
// Vocabulario canónico de estados y slot automático
// =====================================================================
describe("V5 estados canónicos y slot automático", () => {
  it("no admite typos ni alias libres como 'queued'", () => {
    expect(V5_TASK_STATUSES).toEqual([
      "pending", "in_progress", "blocked", "completed",
      "skipped", "no_procede", "superseded", "cancelled",
    ]);
    for (const bad of ["queued", "Pending", "in-progress", "done", "", null, 3]) {
      expect(isV5TaskStatus(bad)).toBe(false);
      expect(occupiesAutomaticSlot({ generationMode: "production", status: bad as string })).toBe(false);
      expect(() => assertV5TaskStatus(bad)).toThrow(/no canónico/);
    }
    expect(decideTaskStart({ status: "queued", generation_mode: "production" })).toMatchObject({
      action: "reject", reason: "estado_no_canonico",
    });
    expect(decideTaskReopen({ status: "queued" })).toMatchObject({ action: "reject", reason: "estado_no_canonico" });
  });

  it("slot ocupado = production pending|in_progress; blocked NO congela la generación", () => {
    expect(occupiesAutomaticSlot({ generationMode: "production", status: "pending" })).toBe(true);
    expect(occupiesAutomaticSlot({ generationMode: "production", status: "in_progress" })).toBe(true);
    // Decisión documentada: la bloqueada es visible como incidencia pero libera el slot.
    expect(occupiesAutomaticSlot({ generationMode: "production", status: "blocked" })).toBe(false);
    for (const s of ["completed", "skipped", "no_procede", "superseded", "cancelled"]) {
      expect(occupiesAutomaticSlot({ generationMode: "production", status: s })).toBe(false);
    }
    for (const m of ["manual", "legacy"]) {
      expect(occupiesAutomaticSlot({ generationMode: m, status: "pending" })).toBe(false);
    }
    expect(
      countOccupiedSlots([
        { generationMode: "production", status: "blocked" },
        { generationMode: "production", status: "pending" },
        { generationMode: "manual", status: "in_progress" },
      ]),
    ).toBe(1);
    expect(isOpenStatus("blocked")).toBe(true);
    expect(isTerminalStatus("blocked")).toBe(false);
    expect(canReopenTask({ status: "blocked" })).toBe(true);
  });
});

// =====================================================================
// 7) Tests estructurales de la migración PENDIENTE (no aplicada)
// =====================================================================
describe("V5 migración pendiente (estructural)", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/pending_migrations/20260811230000_v5_engine_phase_a.sql"),
    "utf8",
  );

  it("generation_mode usa legacy como default y dominio con legacy", () => {
    expect(sql).toMatch(/generation_mode\s+text NOT NULL DEFAULT 'legacy'/);
    expect(sql).toMatch(/ALTER COLUMN generation_mode SET DEFAULT 'legacy'/);
    expect(sql).toMatch(/generation_mode IN \('legacy','production','demo','manual'\)/);
    expect(sql).not.toMatch(/DEFAULT 'manual'/);
    expect(sql).not.toMatch(/UPDATE public\.building_tasks/);
    expect(sql).not.toMatch(/DELETE FROM public\.building_tasks/);
  });

  it("production exige el contrato completo", () => {
    for (const col of [
      "user_id",
      "task_code",
      "subject_type",
      "subject_id",
      "rules_version",
      "trigger_fingerprint",
      "eligibility_snapshot",
      "mode_snapshot",
      "task_key",
    ]) {
      expect(sql).toMatch(new RegExp(`${col}\\s+IS NOT NULL`));
    }
    expect(sql).toMatch(/building_tasks_production_contract_chk/);
  });

  it("concordancia código/clave y prohibición de T7/T2/T3", () => {
    expect(sql).toMatch(/split_part\(task_key, ':', 3\) = task_code/);
    expect(sql).toMatch(/task_key !~\* '\^v5:\[\^:\]\*:\(t7\|t2\|t3\):'/);
    expect(sql).toMatch(/task_code IN \('T1','T2_T3','T4','T5','T6','T8','T9'\)/);
  });

  it("ventana exacta timestamptz sin cast a date", () => {
    expect(sql).toMatch(/CHECK \(starts_at IS NULL OR due_date IS NULL OR due_date >= starts_at\)/);
    expect(sql).not.toMatch(/starts_at::date/);
  });

  it("unicidad idempotente sólo en production y una activa por comercial", () => {
    expect(sql).toMatch(/building_tasks_v5_production_key_uidx[\s\S]*?WHERE generation_mode = 'production' AND task_key LIKE 'v5:%'/);
    expect(sql).toMatch(/building_tasks_one_active_production_uidx[\s\S]*?user_id IS NOT NULL/);
  });

  it("manual y demo tienen contrato propio y hay preflight fail-closed", () => {
    expect(sql).toMatch(/building_tasks_manual_contract_chk/);
    expect(sql).toMatch(/created_by\s+IS NOT NULL/);
    expect(sql).toMatch(/generation_mode <> 'demo' OR simulation_run_id IS NOT NULL/);
    expect((sql.match(/RAISE EXCEPTION/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});

describe("V5 no toca producción", () => {
  it("ningún módulo importa el cliente de datos", () => {
    for (const f of ["model", "eligibility", "modes", "revalidate", "manualDemo"]) {
      const src = readFileSync(resolve(process.cwd(), `src/lib/v5/${f}.ts`), "utf8");
      expect(src).not.toMatch(/integrations\/supabase/);
      expect(src).not.toMatch(/\bfetch\(/);
    }
  });
});
