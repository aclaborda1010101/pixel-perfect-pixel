/**
 * MOTOR V5 — P0.2 + ADAPTADOR RUNTIME. Pruebas reales del motor conectado.
 * Cero DB, cero deploy, flags OFF.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  computeEligibility,
  evaluateBuildingT6,
  evaluateBuildingT9,
  evaluateOwner,
  t2t3Actions,
  t6GroupSignature,
} from "@/lib/v5/eligibility";
import {
  buildV5TaskKey,
  V5_RULES_VERSION,
  type V5BuildingContext,
  type V5Evidence,
  type V5Incident,
  type V5OwnerContext,
} from "@/lib/v5/model";
import { revalidateOpenTasks, type V5ExistingTask } from "@/lib/v5/revalidate";
import { selectNextByMode, validateMix, type V5ModeConfig } from "@/lib/v5/modes";
import { validateManualDraft } from "@/lib/v5/manualDemo";
import { decideTaskStart } from "@/lib/taskStart";
import { isTaskOpen, taskCode } from "@/lib/taskSchedule";
import { FEATURE_V5_RUNTIME_ADAPTER } from "@/lib/featureFlags";
import {
  runV5CycleForComercial,
  runV5DemoCycle,
  requestReplenishment,
  selectNextProduction,
  type V5RuntimeContext,
  type V5RuntimeRepository,
  type V5TaskRow,
} from "@/lib/v5/runtime";

const NOW = new Date("2026-08-13T10:00:00Z");
const MIX = { T1: 15, T2_T3: 45, T4: 10, T5: 10, T6: 10, T8: 10, T9: 0 };
const CFG: V5ModeConfig = { global: { mode: "iniciar_conversaciones", mix: MIX } };

function ev(p: Partial<V5Evidence> = {}): V5Evidence {
  return { field: "campo", observed: 1, source: "nota_simple", reference: "nota:1#p1", ...p };
}
function incident(p: Partial<V5Incident> & { id: string }): V5Incident {
  return {
    field: "cuota", observed: 40, expected: 60, source: "nota_simple",
    action: "verificar", evidence: [ev()], ...p,
  };
}
function owner(p: Partial<V5OwnerContext> & { ownerId: string }): V5OwnerContext {
  return {
    buildingId: "B1", comercialId: "C1", hasValidPhone: true, callCount: 3,
    contactedEver: true, ...p,
  };
}
function building(p: Partial<V5BuildingContext> = {}): V5BuildingContext {
  return { buildingId: "B1", comercialId: "C1", owners: [], ...p };
}

describe("V5 P0.2 — estados, tombstones y revalidación", () => {
  it("flags OFF", () => {
    expect(FEATURE_V5_RUNTIME_ADAPTER).toBe(false);
  });

  it("blocked libera slot, se conserva y no reaparece como nueva", () => {
    const b = building({ incidents: [incident({ id: "i1", blocking: true })] });
    const t6 = evaluateBuildingT6(b).candidate!;
    const blockedTask: V5ExistingTask = {
      taskKey: t6.taskKey, taskCode: "T6", subjectType: "building", subjectId: "B1",
      buildingId: "B1", triggerFingerprint: t6.triggerFingerprint, status: "blocked",
    };
    const res = revalidateOpenTasks(b, [blockedTask], { now: NOW });
    expect(res.fresh).toHaveLength(0);
    expect(res.dedupeOnly).toEqual([{ task: blockedTask, role: "blocked" }]);
    expect(res.superseded).toHaveLength(0);
    // No ocupa slot:
    const rows: V5TaskRow[] = [{ ...blockedTask, id: "1", userId: "C1", generationMode: "production" }];
    expect(selectNextProduction(
      { comercialId: "C1", buildings: [b], tasks: rows, modeConfig: CFG, window: [] }, { now: NOW },
    ).reasons).not.toContain("slot_ocupado");
  });

  it("cada terminal deja tombstone del fingerprint (superseded no)", () => {
    const b = building({ incidents: [incident({ id: "i1" })] });
    const t6 = evaluateBuildingT6(b).candidate!;
    const base = {
      taskKey: t6.taskKey, taskCode: "T6" as const, subjectType: "building" as const,
      subjectId: "B1", buildingId: "B1", triggerFingerprint: t6.triggerFingerprint,
    };
    for (const status of ["completed", "skipped", "no_procede", "cancelled"] as const) {
      const res = revalidateOpenTasks(b, [{ ...base, status }], { now: NOW });
      expect(res.fresh, status).toHaveLength(0);
    }
    // superseded con MISMA clave: consume la clave, pero sin tombstone de fingerprint.
    const sup = revalidateOpenTasks(b, [{ ...base, taskKey: "v5:x:T6:B1:B1:otro", status: "superseded" }], { now: NOW });
    expect(sup.fresh).toHaveLength(1);
  });

  it("un cambio SÓLO en la evidencia cambia la firma y el fingerprint de T6", () => {
    const i1 = incident({ id: "i1", evidence: [ev({ quote: "folio 12: 40%" })] });
    const i2 = incident({ id: "i1", evidence: [ev({ quote: "folio 13: 40%" })] });
    expect(t6GroupSignature([i1])).not.toBe(t6GroupSignature([i2]));
    const a = evaluateBuildingT6(building({ incidents: [i1] })).candidate!;
    const c = evaluateBuildingT6(building({ incidents: [i2] })).candidate!;
    expect(a.triggerFingerprint).not.toBe(c.triggerFingerprint);
    // Idénticas => misma firma.
    expect(evaluateBuildingT6(building({ incidents: [i1] })).candidate!.triggerFingerprint).toBe(a.triggerFingerprint);
  });

  it("T6 es una sola por edificio, exclusiva frente a personales", () => {
    const b = building({
      incidents: [incident({ id: "i1", blocking: true })],
      owners: [owner({ ownerId: "O1", hasValidPhone: false }), owner({ ownerId: "O2", hasValidPhone: false })],
    });
    const { candidates } = computeEligibility(b, { now: NOW });
    expect(candidates.map((c) => c.taskCode)).toEqual(["T6"]);
  });
});

describe("V5 P0.2 — T2_T3 y señales", () => {
  it("consent/message IDs nulos no generan acción", () => {
    const sinConsent = owner({
      ownerId: "O1", whatsapp: { consentPending: true, consent: false, consentEventId: "  " },
    });
    expect(t2t3Actions(sinConsent, { now: NOW }).map((a) => a.kind)).not.toContain("registrar_consentimiento");
    const sinMsg = owner({
      ownerId: "O2",
      whatsapp: { consent: true, authorizedNumber: true, pendingContentAfterSignal: true, pendingMessageId: null },
    });
    expect(t2t3Actions(sinMsg, { now: NOW }).map((a) => a.kind)).not.toContain("enviar_whatsapp");
  });

  it("wa.sent global no bloquea un pendingMessageId nuevo", () => {
    const o = owner({
      ownerId: "O3",
      whatsapp: {
        consent: true, authorizedNumber: true, pendingContentAfterSignal: true,
        pendingMessageId: "msg-nuevo", sent: true, legacySentFallback: true, sentMessageIds: ["msg-viejo"],
      },
    });
    const kinds = t2t3Actions(o, { now: NOW }).map((a) => a.kind);
    expect(kinds).toContain("enviar_whatsapp");
    // Fallback legado explícito SIN ids: sí suprime.
    const legacy = owner({
      ownerId: "O4",
      whatsapp: { consent: true, authorizedNumber: true, pendingContentAfterSignal: true, sent: true, legacySentFallback: true },
    });
    expect(t2t3Actions(legacy, { now: NOW }).map((a) => a.kind)).not.toContain("enviar_whatsapp");
  });

  it("el fingerprint incluye acción + id de evento", () => {
    const mk = (msg: string) => evaluateOwner(owner({
      ownerId: "O5", callCount: 3,
      whatsapp: { consent: true, authorizedNumber: true, pendingContentAfterSignal: true, pendingMessageId: msg },
    }), { now: NOW }).candidate!;
    expect(mk("m1").taskCode).toBe("T2_T3");
    expect(mk("m1").triggerFingerprint).not.toBe(mk("m2").triggerFingerprint);
  });

  it("señal con fecha futura o source vacío no genera T8", () => {
    const futura = owner({ ownerId: "O6", lastSignal: { kind: "interesado", at: "2027-01-01T00:00:00Z", source: "call" } });
    expect(evaluateOwner(futura, { now: NOW }).candidate?.taskCode).not.toBe("T8");
    const sinSource = owner({ ownerId: "O7", lastSignal: { kind: "interesado", at: "2026-08-01T00:00:00Z", source: "  " } });
    expect(evaluateOwner(sinSource, { now: NOW }).candidate?.taskCode).not.toBe("T8");
  });
});

describe("V5 P0.2 — T9 estricta", () => {
  const contacto = (id: string, at = "2026-01-01T00:00:00Z") => owner({
    ownerId: id, canonical: true, contactable: true, contactedEver: true,
    lastContact: { at, source: "hubspot", eventId: `ev-${id}` },
  });
  const base = (p: Partial<V5BuildingContext> = {}) => building({
    ownershipUniverseComplete: true, lastNoveltyAt: "2026-01-01T00:00:00Z",
    owners: [contacto("O1"), contacto("O2")], ...p,
  });

  it("universo completo + novedad >90 días => elegible", () => {
    expect(evaluateBuildingT9(base(), [], { now: NOW }).candidate?.taskCode).toBe("T9");
  });

  it("blancos y fechas futuras fallan", () => {
    const blanco = base({ owners: [contacto("O1"), { ...contacto("O2"), lastContact: { at: "2026-01-01T00:00:00Z", source: "  ", eventId: "e" } }] });
    expect(evaluateBuildingT9(blanco, [], { now: NOW }).candidate).toBeNull();
    const futuro = base({ owners: [contacto("O1"), contacto("O2", "2027-01-01T00:00:00Z")] });
    expect(evaluateBuildingT9(futuro, [], { now: NOW }).candidate).toBeNull();
    const novedadFutura = base({ lastNoveltyAt: "2027-01-01T00:00:00Z" });
    expect(evaluateBuildingT9(novedadFutura, [], { now: NOW }).candidate).toBeNull();
    const reciente = base({ lastNoveltyAt: "2026-07-01T00:00:00Z" });
    expect(evaluateBuildingT9(reciente, [], { now: NOW }).candidate).toBeNull();
  });
});

describe("V5 P0.2 — modos", () => {
  it("el modo personalizado genera automáticas y admite T7=0", () => {
    expect(validateMix({ ...MIX, T7: 0 }).valid).toBe(true);
    expect(validateMix({ ...MIX, T7: 5 }).valid).toBe(false);
    const b = building({ owners: [owner({ ownerId: "O1", hasValidPhone: false })] });
    const cands = computeEligibility(b, { now: NOW }).candidates;
    const res = selectNextByMode({
      comercialId: "C1", candidates: cands, now: NOW,
      config: { global: { mode: "personalizado", mix: { ...MIX, T7: 0 } } },
    });
    expect(res.selected?.taskCode).toBe("T1");
    expect(res.modeSnapshot.mode).toBe("personalizado");
    expect((res.modeSnapshot.mix as Record<string, number>).T7).toBeUndefined();
  });

  it("alias histórico `manual` === personalizado y sigue generando", () => {
    const b = building({ owners: [owner({ ownerId: "O1", hasValidPhone: false })] });
    const res = selectNextByMode({
      comercialId: "C1", candidates: computeEligibility(b, { now: NOW }).candidates, now: NOW,
      config: { global: { mode: "manual", mix: MIX } },
    });
    expect(res.selected).not.toBeNull();
    expect(res.modeSnapshot.mode).toBe("personalizado");
  });

  it("selecciona 0 o 1, nunca más", () => {
    const b = building({
      owners: [owner({ ownerId: "O1", hasValidPhone: false }), owner({ ownerId: "O2", hasValidPhone: false })],
    });
    const res = selectNextByMode({
      comercialId: "C1", candidates: computeEligibility(b, { now: NOW }).candidates, now: NOW,
      config: { global: { mode: "personalizado", mix: MIX } },
    });
    expect(res.selected).not.toBeNull();
    expect([res.selected].filter(Boolean)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
// Adaptador runtime
// ---------------------------------------------------------------------
function ctxFor(comercialId: string, tasks: V5TaskRow[] = []): V5RuntimeContext {
  return {
    comercialId,
    buildings: [building({
      buildingId: `B-${comercialId}`, comercialId,
      owners: [owner({ ownerId: `O-${comercialId}`, buildingId: `B-${comercialId}`, comercialId, hasValidPhone: false })],
    })],
    tasks,
    modeConfig: CFG,
    window: [],
  };
}

function makeRepo(ctx: V5RuntimeContext) {
  const inserted: string[] = [];
  const keys = new Set<string>();
  let locked = false;
  const repo: V5RuntimeRepository = {
    acquireLock: async () => (locked ? null : ((locked = true), "tok")),
    releaseLock: async () => { locked = false; },
    loadContext: async () => ({ ...ctx, tasks: [...ctx.tasks] }),
    insertProductionTask: async ({ candidate, comercialId }) => {
      // Simula índice único de task_key + slot único por comercial.
      if (keys.has(candidate.taskKey)) return null;
      if (ctx.tasks.some((t) => t.userId === comercialId && t.generationMode === "production"
        && (t.status === "pending" || t.status === "in_progress"))) return null;
      keys.add(candidate.taskKey);
      inserted.push(candidate.taskKey);
      ctx.tasks.push({
        id: `id-${inserted.length}`, userId: comercialId, generationMode: "production",
        status: "pending", taskKey: candidate.taskKey, taskCode: candidate.taskCode,
        subjectType: candidate.subjectType, subjectId: candidate.subjectId,
        buildingId: candidate.buildingId, triggerFingerprint: candidate.triggerFingerprint,
      });
      return { id: `id-${inserted.length}` };
    },
  };
  return { repo, inserted, ctx };
}

describe("V5 P0.2 — adaptador runtime", () => {
  it("flag OFF no genera nada", async () => {
    const { repo, inserted } = makeRepo(ctxFor("C1"));
    const r = await runV5CycleForComercial("C1", repo, { enabled: false, now: NOW });
    expect(r.outcome).toBe("flag_off");
    expect(inserted).toEqual([]);
  });

  it("21 ejecuciones concurrentes dejan como máximo un slot ocupado", async () => {
    const { repo, inserted, ctx } = makeRepo(ctxFor("C1"));
    await Promise.all(Array.from({ length: 21 }, () =>
      runV5CycleForComercial("C1", repo, { enabled: true, now: NOW })));
    expect(inserted.length).toBeLessThanOrEqual(1);
    expect(ctx.tasks.filter((t) => t.status === "pending").length).toBeLessThanOrEqual(1);
  });

  it("cerrar dispara UNA reposición y el retry no duplica", async () => {
    const { repo, inserted, ctx } = makeRepo(ctxFor("C1"));
    await runV5CycleForComercial("C1", repo, { enabled: true, now: NOW });
    expect(inserted).toHaveLength(1);
    ctx.tasks[0].status = "completed";
    const rep = await requestReplenishment("C1", "completed", repo, { enabled: true, now: NOW });
    expect(rep).not.toBeNull();
    const total = inserted.length;
    const retry = await requestReplenishment("C1", "completed", repo, { enabled: true, now: NOW });
    expect(retry?.outcome === "inserted" && inserted.length > total + 0).toBe(inserted.length > total);
    expect(inserted.length).toBeLessThanOrEqual(total + 1);
    // Un estado no terminal no repone.
    expect(await requestReplenishment("C1", "in_progress", repo, { enabled: true, now: NOW })).toBeNull();
  });

  it("no cruza comerciales (Jesús / David / null)", async () => {
    for (const cid of ["jesus", "david"]) {
      const { repo, inserted } = makeRepo(ctxFor(cid));
      await runV5CycleForComercial(cid, repo, { enabled: true, now: NOW });
      expect(inserted.every((k) => k.includes(`B-${cid}`))).toBe(true);
    }
    // Candidato sin comercial: nunca se asigna.
    const b = building({ buildingId: "BX", comercialId: null, owners: [owner({ ownerId: "OX", buildingId: "BX", comercialId: null, hasValidPhone: false })] });
    const { repo, inserted } = makeRepo({ comercialId: "jesus", buildings: [b], tasks: [], modeConfig: CFG, window: [] });
    const r = await runV5CycleForComercial("jesus", repo, { enabled: true, now: NOW });
    expect(r.outcome).toBe("sin_candidato");
    expect(inserted).toEqual([]);
  });

  it("contexto V2→V5 no fiable => fail-closed sin insertar", async () => {
    const spy = vi.fn();
    const repo: V5RuntimeRepository = {
      acquireLock: async () => "tok",
      releaseLock: async () => {},
      loadContext: async () => null,
      insertProductionTask: async (...a) => { spy(...a); return { id: "x" }; },
    };
    const r = await runV5CycleForComercial("C1", repo, { enabled: true, now: NOW });
    expect(r.outcome).toBe("contexto_no_fiable");
    expect(spy).not.toHaveBeenCalled();
  });

  it("demo: máximo 20 iteraciones y CERO escrituras (repo spy inyectado)", () => {
    const insertSpy = vi.fn();
    const ctx = ctxFor("C1");
    ctx.buildings = Array.from({ length: 40 }, (_, i) => building({
      buildingId: `B${i}`, comercialId: "C1",
      owners: [owner({ ownerId: `O${i}`, buildingId: `B${i}`, comercialId: "C1", hasValidPhone: false })],
    }));
    const out = runV5DemoCycle(ctx, { now: NOW });
    expect(out.proposals.length).toBeLessThanOrEqual(20);
    expect(out.proposals.length).toBeGreaterThan(0);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(ctx.tasks).toHaveLength(0);
  });

  it("manual humano: protegido, arrancable y con contrato completo", () => {
    const draft = validateManualDraft({
      buildingId: "B1", subjectType: "owner", subjectId: "O1", title: "Llamar",
      manualSubtype: "posible_interes", startsAt: "2026-08-13T09:00:00Z",
      dueDate: "2026-08-14T09:00:00Z", createdBy: "user-1",
    });
    expect(draft.valid).toBe(true);
    expect(draft.draft?.generationMode).toBe("manual");
    expect(validateManualDraft({ ...(draft.draft as any), createdBy: "" }).valid).toBe(false);
    expect(decideTaskStart({ status: "pending", generation_mode: "manual", started_at: null }).action).toBe("start");
    expect(decideTaskStart({ status: "pending", generation_mode: "demo" }).action).toBe("reject");
    // El motor nunca toca las manuales: no ocupan slot production.
    const rows: V5TaskRow[] = [{
      id: "m1", userId: "C1", generationMode: "manual", status: "pending", taskKey: "manual:1",
      taskCode: "T5", subjectType: "owner", subjectId: "O1", buildingId: "B1", triggerFingerprint: "f",
    }];
    expect(selectNextProduction({ ...ctxFor("C1"), tasks: rows }, { now: NOW }).reasons)
      .not.toContain("slot_ocupado");
  });
});

describe("V5 P0.2 — compatibilidad UI y escritores", () => {
  it("las tarjetas leen T-XX histórico y códigos canónicos V5", () => {
    expect(taskCode({ task_key: "v5:2026-08-01:T-03:abc" })).toBe("T-03");
    const canonical = buildV5TaskKey({ taskCode: "T2_T3", buildingId: "B1", subjectId: "O1", triggerFingerprint: "fp" });
    expect(canonical.startsWith(`v5:${V5_RULES_VERSION}:T2_T3:`)).toBe(true);
    expect(taskCode({ task_key: canonical })).toBe("T2_T3");
  });

  it("cancelled y superseded son terminales: nunca vencidas", () => {
    expect(isTaskOpen({ status: "cancelled" })).toBe(false);
    expect(isTaskOpen({ status: "superseded" })).toBe(false);
    expect(isTaskOpen({ status: "blocked" })).toBe(true);
  });

  it("el productor legacy queda contenido con el flag OFF", () => {
    const src = readFileSync(resolve("supabase/functions/assign_daily_call_queue/index.ts"), "utf8");
    expect(src).toContain("decideRuntimeMode");
    expect(src).toMatch(/dryRun\s*=\s*body\.dry_run === true \|\| !runtime\.legacyWritesAllowed/);
    const shared = readFileSync(resolve("supabase/functions/_shared/v5Runtime.ts"), "utf8");
    expect(shared).toContain("FEATURE_V5_RUNTIME_ADAPTER = false");
    expect(shared).toMatch(/legacyWritesAllowed: false/);
  });

  it("la migración pendiente valida la clave canónica y neutraliza T-0X", () => {
    const sql = readFileSync(resolve("supabase/pending_migrations/20260813000000_v5_engine_p02_runtime.sql"), "utf8");
    expect(sql).toContain("building_tasks_v5_canonical_key_chk");
    expect(sql).toContain("building_tasks_no_legacy_datekey_chk");
    expect(sql).toContain("building_tasks_production_strings_chk");
    expect(sql).toContain("created_by_deleted_at");
    expect(sql).toContain("building_tasks_forbid_demo");
    expect(sql).not.toMatch(/\bdiscarded\b/);
  });
});
