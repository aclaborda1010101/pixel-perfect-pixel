import { describe, expect, it, vi } from "vitest";
import {
  computeEligibility,
  evaluateBuildingT9,
  evaluateOwner,
} from "@/lib/v5/eligibility";
import { buildV5TaskKey, V5_RULES_VERSION, type V5BuildingContext, type V5OwnerContext } from "@/lib/v5/model";
import { revalidateOpenTasks } from "@/lib/v5/revalidate";
import { selectByMode, validateMix, V5_MODE_TEMPLATES, type V5ModeConfig } from "@/lib/v5/modes";
import { buildDemoProposals, validateManualDraft } from "@/lib/v5/manualDemo";
import { FEATURE_V5_ENGINE_PHASE_A } from "@/lib/featureFlags";

const NOW = new Date("2026-08-11T10:00:00Z");
const TOMORROW = new Date("2026-08-12T10:00:00Z");

function owner(partial: Partial<V5OwnerContext> & { ownerId: string }): V5OwnerContext {
  return {
    buildingId: "B1",
    hasValidPhone: true,
    callCount: 3,
    contactedEver: true,
    ...partial,
  };
}

function building(partial: Partial<V5BuildingContext> = {}): V5BuildingContext {
  return { buildingId: "B1", owners: [], ...partial };
}

describe("V5 fase A — flag", () => {
  it("está desactivado", () => {
    expect(FEATURE_V5_ENGINE_PHASE_A).toBe(false);
  });
});

describe("V5 elegibilidad por propietario", () => {
  it("interesado => sólo T8", () => {
    const res = evaluateOwner(
      owner({
        ownerId: "O1",
        lastSignal: { kind: "interesado", at: "2026-08-01T00:00:00Z", source: "call" },
        cadence: { dueAt: "2026-01-01T00:00:00Z", channelUsable: true },
        missingCommercialFields: ["motivacion", "urgencia"],
      }),
      { now: NOW },
    );
    expect(res.candidate?.taskCode).toBe("T8");
    expect(res.candidate?.urgent).toBe(true);
  });

  it("sin teléfono => T1, nunca T2/T4", () => {
    const res = evaluateOwner(
      owner({
        ownerId: "O2",
        hasValidPhone: false,
        callCount: 0,
        cadence: { dueAt: "2026-01-01T00:00:00Z", channelUsable: true },
      }),
      { now: NOW },
    );
    expect(res.candidate?.taskCode).toBe("T1");
    expect(res.candidate?.eligibilitySnapshot.llamar).toBe(false);
  });

  it("teléfono + cero llamadas => una T2_T3 primera llamada", () => {
    const res = evaluateOwner(owner({ ownerId: "O3", callCount: 0, contactedEver: false }), { now: NOW });
    expect(res.candidate?.taskCode).toBe("T2_T3");
    expect(res.candidate?.variant).toBe("primera_llamada");
  });

  it("consentimiento + WhatsApp pendiente => misma T2_T3, no T3", () => {
    const res = evaluateOwner(
      owner({
        ownerId: "O4",
        callCount: 2,
        whatsapp: { consent: true, authorizedNumber: true, pendingContentAfterSignal: true },
      }),
      { now: NOW },
    );
    expect(res.candidate?.taskCode).toBe("T2_T3");
    expect(res.candidate?.variant).toBe("whatsapp_pendiente");
    expect(res.candidate?.taskKey).toContain(":T2_T3:");
    expect(res.candidate?.taskKey).not.toContain(":T3:");
  });

  it("T4 sólo con cadencia vencida y canal utilizable", () => {
    const due = evaluateOwner(
      owner({ ownerId: "O5", cadence: { dueAt: "2026-08-01T00:00:00Z", channelUsable: true } }),
      { now: NOW },
    );
    expect(due.candidate?.taskCode).toBe("T4");
    const notDue = evaluateOwner(
      owner({ ownerId: "O5", cadence: { dueAt: "2026-12-01T00:00:00Z", channelUsable: true } }),
      { now: NOW },
    );
    expect(notDue.candidate).toBeNull();
  });

  it("T5 nunca usa cuota/porcentaje/derecho registral", () => {
    const res = evaluateOwner(
      owner({
        ownerId: "O6",
        missingCommercialFields: ["cuota", "porcentaje_pleno", "derecho_registral", "motivacion", "urgencia"],
      }),
      { now: NOW },
    );
    expect(res.candidate?.taskCode).toBe("T5");
    const campos = res.candidate?.eligibilitySnapshot.campos_permitidos as string[];
    expect(campos).toEqual(["motivacion", "urgencia"]);
    expect(JSON.stringify(res.candidate)).not.toMatch(/cuota|porcentaj|derecho/i);
  });

  it("T5 exige al menos 2 campos permitidos", () => {
    const res = evaluateOwner(owner({ ownerId: "O7", missingCommercialFields: ["motivacion"] }), { now: NOW });
    expect(res.candidate).toBeNull();
  });

  it("identidad/derechos bloquean tareas personales", () => {
    for (const flag of ["ambiguousIdentity", "unresolvedDuplicate", "contradictoryRight", "unreconciledOwner"] as const) {
      const res = evaluateOwner(
        owner({ ownerId: "O8", callCount: 0, identity: { [flag]: true } }),
        { now: NOW },
      );
      expect(res.candidate).toBeNull();
      expect(res.blockers.length).toBe(1);
    }
  });
});

describe("V5 elegibilidad de edificio", () => {
  it("10 propietarios + 1 incidencia => una sola T6 con evidencia", () => {
    const owners = Array.from({ length: 10 }, (_, i) => owner({ ownerId: `O${i}`, callCount: 1 }));
    owners[3].incidents = [
      {
        field: "suma_pleno_verificado",
        observed: 82,
        expected: 100,
        source: "nota_simple",
        action: "Revisar titularidad registral",
        blocking: true,
        evidence: [{ field: "suma_pleno_verificado", observed: 82, source: "nota:123", quote: "pleno dominio 82%" }],
      },
    ];
    const res = computeEligibility(
      building({ owners, sumaPlenoVerificado: 82, derechosVerificados: 9, bloqueosDerechos: 1 }),
      { now: NOW },
    );
    const t6 = res.candidates.filter((c) => c.taskCode === "T6");
    expect(t6).toHaveLength(1);
    expect(t6[0].evidence.length).toBeGreaterThan(0);
    expect(t6[0].blocking).toBe(true);
    expect(t6[0].eligibilitySnapshot.alineacion).toEqual({
      suma_pleno_verificado: 82,
      derechos_verificados: 9,
      bloqueos_derechos: 1,
    });
  });

  it("bloqueo de identidad sólo permite T6 con incidencia accionable", () => {
    const o = owner({
      ownerId: "OX",
      callCount: 0,
      identity: { ambiguousIdentity: true },
      incidents: [
        {
          field: "identidad",
          observed: "2 candidatos",
          expected: "1 titular",
          source: "owners",
          action: "Desambiguar titular",
          evidence: [{ field: "identidad", observed: "2 candidatos", source: "owners" }],
        },
      ],
    });
    const res = computeEligibility(building({ owners: [o] }), { now: NOW });
    expect(res.candidates.map((c) => c.taskCode)).toEqual(["T6"]);
  });

  it("T9 falla si un contactable no fue contactado", () => {
    const owners = [
      owner({ ownerId: "A", contactedEver: true, callCount: 2, lastContactAt: "2025-01-01T00:00:00Z" }),
      owner({ ownerId: "B", contactedEver: false, callCount: 0 }),
    ];
    const res = evaluateBuildingT9(building({ owners, lastNoveltyAt: "2025-01-01T00:00:00Z" }), [], { now: NOW });
    expect(res.candidate).toBeNull();
    expect(res.reason).toContain("sin contactar");
  });

  it("T9 elegible con todos contactados y sin novedad 90 días", () => {
    const owners = [
      owner({ ownerId: "A", contactedEver: true, callCount: 2, lastContactAt: "2025-01-01T00:00:00Z", missingCommercialFields: [] }),
      owner({ ownerId: "B", contactedEver: true, callCount: 1, lastContactAt: "2025-02-01T00:00:00Z", missingCommercialFields: [] }),
    ];
    const res = evaluateBuildingT9(building({ owners, lastNoveltyAt: "2025-03-01T00:00:00Z" }), [], { now: NOW });
    expect(res.candidate?.taskCode).toBe("T9");
  });

  it("T7 siempre cero candidatos y aparece como rechazo", () => {
    const res = computeEligibility(building({ owners: [owner({ ownerId: "A", callCount: 0 })] }), { now: NOW });
    expect(res.candidates.some((c) => (c.taskCode as string) === "T7")).toBe(false);
    expect(res.rejections.some((r) => r.taskCode === "T7")).toBe(true);
    expect(() =>
      buildV5TaskKey({ taskCode: "T7" as never, buildingId: "B1", subjectId: "A", triggerFingerprint: "x" }),
    ).toThrow();
  });
});

describe("V5 revalidación", () => {
  it("T1 con teléfono ya disponible queda superseded y no reaparece al día siguiente", () => {
    const before = owner({ ownerId: "O1", hasValidPhone: false, callCount: 0 });
    const initial = evaluateOwner(before, { now: NOW }).candidate!;
    expect(initial.taskCode).toBe("T1");

    const after = building({ owners: [owner({ ownerId: "O1", hasValidPhone: true, callCount: 5, missingCommercialFields: [] })] });
    const open = [
      {
        taskKey: initial.taskKey,
        taskCode: initial.taskCode,
        subjectType: "owner" as const,
        subjectId: "O1",
        buildingId: "B1",
        triggerFingerprint: initial.triggerFingerprint,
      },
    ];
    const today = revalidateOpenTasks(after, open, { now: NOW });
    expect(today.superseded[0].supersededReason).toBe("t1_telefono_ya_disponible");

    const tomorrow = revalidateOpenTasks(after, open, { now: TOMORROW });
    expect(tomorrow.valid).toHaveLength(0);
    const keys = computeEligibility(after, { now: TOMORROW }).candidates.map((c) => c.taskKey);
    expect(keys).not.toContain(initial.taskKey);
  });

  it("T4 con nueva señal interesada => superseded", () => {
    const t4 = evaluateOwner(owner({ ownerId: "O2", cadence: { dueAt: "2026-08-01T00:00:00Z", channelUsable: true } }), { now: NOW }).candidate!;
    const after = building({
      owners: [owner({ ownerId: "O2", lastSignal: { kind: "interesado", at: "2026-08-10T00:00:00Z", source: "call" } })],
    });
    const res = revalidateOpenTasks(after, [
      { taskKey: t4.taskKey, taskCode: "T4", subjectType: "owner", subjectId: "O2", buildingId: "B1", triggerFingerprint: t4.triggerFingerprint },
    ], { now: NOW });
    expect(res.superseded[0].supersededReason).toBe("t4_nueva_senal_interesado");
  });

  it("T2_T3 con envío hecho => superseded", () => {
    const t23 = evaluateOwner(owner({ ownerId: "O3", callCount: 0 }), { now: NOW }).candidate!;
    const after = building({ owners: [owner({ ownerId: "O3", callCount: 1, whatsapp: { sent: true }, missingCommercialFields: [] })] });
    const res = revalidateOpenTasks(after, [
      { taskKey: t23.taskKey, taskCode: "T2_T3", subjectType: "owner", subjectId: "O3", buildingId: "B1", triggerFingerprint: t23.triggerFingerprint },
    ], { now: NOW });
    expect(res.superseded[0].supersededReason).toBe("t2_t3_envio_realizado");
  });

  it("T6 resuelta => superseded", () => {
    const inc = {
      field: "suma_pleno_verificado",
      observed: 80,
      expected: 100,
      source: "nota",
      action: "revisar",
      evidence: [{ field: "suma", observed: 80, source: "nota:1" }],
    };
    const withInc = building({ owners: [], incidents: [inc] });
    const t6 = computeEligibility(withInc, { now: NOW }).candidates.find((c) => c.taskCode === "T6")!;
    const resolved = building({ owners: [], incidents: [{ ...inc, resolved: true }] });
    const res = revalidateOpenTasks(resolved, [
      { taskKey: t6.taskKey, taskCode: "T6", subjectType: "building", subjectId: "B1", buildingId: "B1", triggerFingerprint: t6.triggerFingerprint },
    ], { now: NOW });
    expect(res.superseded[0].supersededReason).toBe("t6_incidencia_resuelta");
  });
});

describe("V5 modos puros", () => {
  const cands = (codes: string[]) =>
    codes.map((code, i) => {
      const o = owner({ ownerId: `O${code}${i}` });
      return {
        taskCode: code as never,
        subjectType: "owner" as const,
        subjectId: o.ownerId,
        buildingId: "B1",
        comercialId: "C1",
        reason: "test",
        evidence: [],
        eligibilitySnapshot: {},
        triggerFingerprint: `fp${i}`,
        taskKey: `v5:${V5_RULES_VERSION}:${code}:B1:${o.ownerId}:fp${i}`,
        rulesVersion: V5_RULES_VERSION,
      };
    });

  it("valida suma 100 y rechaza T7 / claves desconocidas", () => {
    expect(validateMix(V5_MODE_TEMPLATES.equilibrado).valid).toBe(true);
    expect(validateMix({ T1: 50, T7: 50 }).errors.join()).toContain("T7");
    expect(validateMix({ T1: 50, TX: 50 }).errors.join()).toContain("desconocido");
    expect(validateMix({ T1: 50, T4: 40 }).valid).toBe(false);
  });

  it("modo manual genera cero automáticas", () => {
    const sel = selectByMode({
      comercialId: "C1",
      candidates: cands(["T4", "T5", "T2_T3"]),
      config: { global: { mode: "manual" } },
      limit: 10,
    });
    expect(sel.selected).toHaveLength(0);
    expect(sel.modeSnapshot.automaticas).toBe(0);
  });

  it("override por comercial gana al global", () => {
    const config: V5ModeConfig = {
      global: { mode: "seguimiento" },
      overrides: { C1: { mode: "manual" } },
    };
    const sel = selectByMode({ comercialId: "C1", candidates: cands(["T4"]), config, limit: 5 });
    expect(sel.modeSnapshot.source).toBe("override");
    expect(sel.selected).toHaveLength(0);
    const other = selectByMode({ comercialId: "C2", candidates: cands(["T4"]), config, limit: 5 });
    expect(other.modeSnapshot.source).toBe("global");
  });

  it("bucket sin elegibles no inventa y se reporta", () => {
    const sel = selectByMode({
      comercialId: "C1",
      candidates: cands(["T4", "T4", "T4"]),
      config: { global: { mode: "seguimiento" } },
      limit: 10,
    });
    expect(sel.selected).toHaveLength(3);
    expect(sel.reasons.join()).toContain("Buckets sin elegibles");
    expect(sel.reasons.join()).toContain("Déficit");
  });

  it("la distribución converge por déficit y es determinista", () => {
    const many = cands([
      ...Array(10).fill("T2_T3"),
      ...Array(10).fill("T4"),
      ...Array(10).fill("T5"),
      ...Array(10).fill("T1"),
    ]);
    const config: V5ModeConfig = { global: { mode: "iniciar_conversaciones" } };
    const a = selectByMode({ comercialId: "C1", candidates: many, config, limit: 20 });
    const b = selectByMode({ comercialId: "C1", candidates: many, config, limit: 20 });
    expect(a.selected.map((c) => c.taskKey)).toEqual(b.selected.map((c) => c.taskKey));
    const t23 = a.selected.filter((c) => c.taskCode === "T2_T3").length;
    expect(t23).toBeGreaterThanOrEqual(8);
  });

  it("T8 urgente y T6 bloqueante ganan y lo justifican en mode_snapshot", () => {
    const base = cands(["T4", "T5"]);
    const urgent = { ...cands(["T8"])[0], urgent: true };
    const blocking = { ...cands(["T6"])[0], blocking: true, subjectType: "building" as const };
    const sel = selectByMode({
      comercialId: "C1",
      candidates: [...base, urgent, blocking],
      config: { global: { mode: "seguimiento" } },
      limit: 2,
    });
    expect(sel.selected.map((c) => c.taskCode).sort()).toEqual(["T6", "T8"]);
    expect((sel.modeSnapshot.prioridades as unknown[]).length).toBe(2);
  });
});

describe("V5 manual y demo", () => {
  it("acepta manual posible_interes con ventana válida", () => {
    const res = validateManualDraft({
      buildingId: "B1",
      subjectType: "owner",
      subjectId: "O1",
      title: "Posible interés",
      manualSubtype: "posible_interes",
      startsAt: "2026-08-11T09:00:00Z",
      dueDate: "2026-08-15T09:00:00Z",
      createdBy: "U1",
    });
    expect(res.valid).toBe(true);
  });

  it("rechaza manual con fin < inicio", () => {
    const res = validateManualDraft({
      buildingId: "B1",
      subjectType: "owner",
      subjectId: "O1",
      title: "X",
      manualSubtype: "posible_interes",
      startsAt: "2026-08-15T09:00:00Z",
      dueDate: "2026-08-11T09:00:00Z",
      createdBy: "U1",
    });
    expect(res.valid).toBe(false);
    const errors = res.valid ? [] : res.errors;
    expect(errors.join()).toContain("anterior");
  });

  it("demo devuelve 20 si hay y no escribe (repo falso)", () => {
    const repo = { insert: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const buildings = Array.from({ length: 30 }, (_, i) =>
      building({ buildingId: `B${i}`, owners: [owner({ ownerId: `O${i}`, buildingId: `B${i}`, callCount: 0 })] }),
    );
    const res = buildDemoProposals({
      comercialId: "C1",
      buildings,
      config: { global: { mode: "iniciar_conversaciones" } },
      now: NOW,
    });
    expect(res.proposals).toHaveLength(20);
    expect(res.shortfall).toBe(0);
    expect(res.writes).toBe(0);
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it("demo reporta déficit X/20 si no hay suficientes", () => {
    const buildings = [building({ owners: [owner({ ownerId: "O1", callCount: 0 })] })];
    const res = buildDemoProposals({
      comercialId: "C1",
      buildings,
      config: { global: { mode: "iniciar_conversaciones" } },
      now: NOW,
    });
    expect(res.proposals.length).toBeLessThan(20);
    expect(res.shortfall).toBeGreaterThan(0);
    expect(res.reasons[0]).toContain("/20");
  });
});

describe("V5 no toca producción", () => {
  it("ninguna importación crea tareas ni usa el cliente de datos", async () => {
    const mods = await Promise.all([
      import("@/lib/v5/model"),
      import("@/lib/v5/eligibility"),
      import("@/lib/v5/modes"),
      import("@/lib/v5/revalidate"),
      import("@/lib/v5/manualDemo"),
    ]);
    expect(mods).toHaveLength(5);
  });
});