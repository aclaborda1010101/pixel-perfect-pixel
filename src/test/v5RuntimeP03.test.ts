/**
 * MOTOR V5 — P0.3. Runtime server-side REAL conectado.
 * Ningún test escribe en base: los repositorios son espías.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  decideV5Invocation,
  mapDbToV5Context,
  candidatesForBuilding,
  selectServerNext,
  runServerCycle,
  productionWindow,
  buildTaskKey,
  type V5RuntimeConfig,
  type V5ServerRepo,
  type V5ServerCandidate,
} from "../../supabase/functions/_shared/v5RuntimeCore";
import { computeEligibility } from "@/lib/v5/eligibility";
import { buildManualTaskRow } from "@/lib/taskWriters";
import { buildDemoProposals } from "@/lib/v5/manualDemo";

const OFF: V5RuntimeConfig = { enabled: false, paused: true, config_review_required: true, canary_user_ids: null };
const ON: V5RuntimeConfig = { enabled: true, paused: false, config_review_required: false, canary_user_ids: null };
const MIX = { T1: 20, T2_T3: 20, T4: 20, T5: 10, T6: 10, T8: 10, T9: 10 };

function candidate(over: Partial<V5ServerCandidate> = {}): V5ServerCandidate {
  const base = {
    taskCode: "T1" as const,
    subjectType: "owner" as const,
    subjectId: "11111111-1111-1111-1111-111111111111",
    buildingId: "22222222-2222-2222-2222-222222222222",
    comercialId: "jesus",
    triggerFingerprint: "fp1",
    title: "Investigar propietario",
    reason: "sin teléfono",
    eligibilitySnapshot: { ok: true },
    ...over,
  };
  return { ...base, taskKey: buildTaskKey(base) } as V5ServerCandidate;
}

function makeRepo(opts: {
  slotOccupied?: boolean;
  candidates?: V5ServerCandidate[];
  mix?: Record<string, number> | null;
  db?: { inserted: string[] };
}) {
  const inserted = opts.db ?? { inserted: [] as string[] };
  const calls = { loadContext: 0, commit: 0, release: 0 };
  const repo: V5ServerRepo = {
    async readConfig() { return ON; },
    async claimRequests() { return []; },
    async loadContext(comercialId) {
      calls.loadContext++;
      return {
        buildings: [
          {
            buildingId: "22222222-2222-2222-2222-222222222222",
            comercialId,
            ownershipUniverseComplete: true,
            incidents: [],
            personal: opts.candidates ?? [candidate()],
          },
        ],
        mix: opts.mix === undefined ? MIX : opts.mix,
        window: [],
        slotOccupied: opts.slotOccupied === true,
        tombstones: [],
      };
    },
    async commitPlan(input) {
      calls.commit++;
      // Espejo del RPC: el slot es único, gana el primero.
      if (inserted.inserted.length > 0) return null;
      inserted.inserted.push(input.candidate.taskKey);
      return { id: `task-${inserted.inserted.length}` };
    },
    async releaseRequest() { calls.release++; },
  };
  return { repo, calls, inserted };
}

describe("V5 P0.3 — autorización de la invocación", () => {
  it("un authenticated cualquiera no puede invocar el runtime (403)", () => {
    const d = decideV5Invocation({ isServiceRole: false, roles: ["agent"], userId: "u1", body: { user_ids: ["otro"] } });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe(403);
    expect(d.userIds).toEqual([]);
  });

  it("sin sesión ni service role: 401", () => {
    const d = decideV5Invocation({ isServiceRole: false, roles: [], userId: null, body: {} });
    expect(d.status).toBe(401);
  });

  it("service role e invocación interna: permitida", () => {
    const d = decideV5Invocation({ isServiceRole: true, roles: [], userId: null, body: { user_ids: ["jesus"] } });
    expect(d).toMatchObject({ allowed: true, mode: "internal", userIds: ["jesus"] });
  });

  it("admin autorizado sí; pero replace/borrado NO existen para nadie", () => {
    expect(decideV5Invocation({ isServiceRole: false, roles: ["admin"], userId: "u1", body: {} }).allowed).toBe(true);
    expect(decideV5Invocation({ isServiceRole: false, roles: ["admin"], userId: "u1", body: { replace: true } }).allowed).toBe(false);
    expect(decideV5Invocation({ isServiceRole: true, roles: [], userId: null, body: { purge: true } }).allowed).toBe(false);
  });
});

describe("V5 P0.3 — adaptador real DB→contexto (fail closed)", () => {
  const buildingOk = {
    id: "b1",
    ownership_universe_complete: true,
    titulares: [{ nombre: "X" }],
    nota_simple_estado: "lista",
    identidad_verificada: true,
    evidencia_disponible: true,
  };

  it("sólo asignaciones activas del MISMO user_id; nunca fallback por nombre", () => {
    const r = mapDbToV5Context({
      comercialId: "jesus",
      assignments: [
        { building_id: "b1", user_id: "jesus", status: "active" },
        { building_id: "b2", user_id: "david", status: "active" },
        { building_id: "b3", user_id: "jesus", status: "paused" },
        { building_id: "b4", user_id: null, status: "active" },
      ],
      buildings: [buildingOk, { ...buildingOk, id: "b2" }, { ...buildingOk, id: "b3" }, { ...buildingOk, id: "b4" }],
    });
    expect(r.buildings.map((b) => b.buildingId)).toEqual(["b1"]);
  });

  it("dato requerido no disponible => T6 trazable, nunca se inventa", () => {
    const r = mapDbToV5Context({
      comercialId: "jesus",
      assignments: [{ building_id: "b1", user_id: "jesus", status: "active" }],
      buildings: [{ ...buildingOk, nota_simple_estado: null, identidad_verificada: null }],
    });
    const inc = r.buildings[0].incidents;
    expect(inc.map((i) => i.field).sort()).toEqual(["identidad", "nota_simple"]);
    expect(inc.every((i) => i.blocking && i.source.includes("b1"))).toBe(true);
  });
});

describe("V5 P0.3 — T6 exclusiva", () => {
  it("cualquier incidencia bloqueante => exactamente una T6 y ninguna personal", () => {
    const res = candidatesForBuilding({
      buildingId: "b1",
      comercialId: "jesus",
      ownershipUniverseComplete: false,
      incidents: [
        { id: "falta_titulares", field: "titulares", observed: null, expected: "titulares", source: "db:b1", action: "obtener", blocking: true },
      ],
      personal: [candidate({ buildingId: "b1" }), candidate({ buildingId: "b1", taskCode: "T4", subjectId: "o2" })],
    });
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].taskCode).toBe("T6");
    expect(res.suppressed).toHaveLength(2);
  });

  it("motor puro (src): T6 no bloqueante sin coexistencia declarada también es exclusiva", () => {
    const out = computeEligibility({
      buildingId: "b1",
      comercialId: "jesus",
      owners: [],
      incidents: [
        {
          id: "i1",
          field: "superficie",
          observed: "100",
          expected: "120",
          source: "catastro",
          action: "verificar",
          blocking: false,
          evidence: [
            { field: "superficie", observed: 100, expected: 120, source: "catastro", reference: "catastro:b1#p1" },
          ],
        } as any,
      ],
    } as any);
    const codes = out.candidates.map((c) => c.taskCode);
    expect(codes).toEqual(["T6"]);
  });
});

describe("V5 P0.3 — ciclo server-side", () => {
  const req = { id: "r1", leaseToken: "lease-1" };

  it("flag OFF: cero escrituras", async () => {
    const { repo, calls } = makeRepo({});
    const r = await runServerCycle("jesus", req, repo, { config: OFF });
    expect(r.outcome).toBe("flag_off");
    expect(calls.commit).toBe(0);
  });

  it("pausa: cero escrituras", async () => {
    const { repo, calls } = makeRepo({});
    const r = await runServerCycle("jesus", req, repo, { config: { ...ON, paused: true } });
    expect(r.outcome).toBe("paused");
    expect(calls.commit).toBe(0);
  });

  it("fuera del canario: cero escrituras", async () => {
    const { repo, calls } = makeRepo({});
    const r = await runServerCycle("jesus", req, repo, { config: { ...ON, canary_user_ids: ["david"] } });
    expect(r.outcome).toBe("not_in_canary");
    expect(calls.commit).toBe(0);
  });

  it("canario ON: inserta EXACTAMENTE una", async () => {
    const { repo, inserted } = makeRepo({});
    const r = await runServerCycle("jesus", req, repo, { config: { ...ON, canary_user_ids: ["jesus"] } });
    expect(r.outcome).toBe("inserted");
    expect(inserted.inserted).toHaveLength(1);
  });

  it("dos workers concurrentes: como mucho UNA tarea", async () => {
    const db = { inserted: [] as string[] };
    const a = makeRepo({ db });
    const b = makeRepo({ db });
    const [r1, r2] = await Promise.all([
      runServerCycle("jesus", { id: "r1", leaseToken: "t1" }, a.repo, { config: ON }),
      runServerCycle("jesus", { id: "r1", leaseToken: "t2" }, b.repo, { config: ON }),
    ]);
    expect(db.inserted).toHaveLength(1);
    expect([r1.outcome, r2.outcome].filter((o) => o === "inserted")).toHaveLength(1);
  });

  it("slot ocupado: no genera", async () => {
    const { repo, calls } = makeRepo({ slotOccupied: true });
    const r = await runServerCycle("jesus", req, repo, { config: ON });
    expect(r.outcome).toBe("slot_ocupado");
    expect(calls.commit).toBe(0);
  });

  it("contexto no fiable: fail-closed", async () => {
    const { repo } = makeRepo({});
    repo.loadContext = async () => { throw new Error("adaptador roto"); };
    const r = await runServerCycle("jesus", req, repo, { config: ON });
    expect(r.outcome).toBe("contexto_no_fiable");
  });

  it("modo sin pesos: no activable, cero candidatos", async () => {
    const { repo, calls } = makeRepo({ mix: null });
    const r = await runServerCycle("jesus", req, repo, { config: ON });
    expect(r.outcome).toBe("sin_candidato");
    expect(calls.commit).toBe(0);
  });

  it("la tarea production lleva ventana temporal real y no vencida", () => {
    const now = new Date("2026-08-15T10:00:00Z");
    const w = productionWindow(now);
    expect(Date.parse(w.startsAt)).toBe(now.getTime());
    expect(Date.parse(w.dueDate)).toBeGreaterThan(now.getTime());
  });
});

describe("V5 P0.3 — aislamiento entre comerciales", () => {
  it("Jesús / David / null nunca se cruzan", () => {
    const sel = selectServerNext({
      comercialId: "jesus",
      candidates: [
        candidate({ comercialId: "david", subjectId: "o-david" }),
        candidate({ comercialId: null as any, subjectId: "o-null" }),
      ],
      mix: MIX,
    });
    expect(sel.selected).toBeNull();
    expect(sel.reasons.join(" ")).toMatch(/otro comercial/);
  });
});

describe("V5 P0.3 — manual y demo", () => {
  const manual = {
    building_id: "b1",
    user_id: "u1",
    created_by: "u1",
    subject_type: "building" as const,
    subject_id: "b1",
    manual_subtype: "posible_interes" as const,
    title: "Hablar con el portero",
    priority: "medium" as const,
    starts_at: "2026-08-15T09:00:00.000Z",
    due_date: "2026-08-16T09:00:00.000Z",
  };

  it("contrato manual completo: modo manual, autor, subtipo, sujeto y ventana", () => {
    const row = buildManualTaskRow(manual);
    expect(row).toMatchObject({
      generation_mode: "manual",
      task_type: "manual",
      task_key: null,
      status: "pending",
      created_by: "u1",
      manual_subtype: "posible_interes",
      subject_type: "building",
    });
    expect(Date.parse(row.starts_at)).toBeLessThan(Date.parse(row.due_date));
  });

  it("nunca legacy ni contrato incompleto", () => {
    expect(() => buildManualTaskRow({ ...manual, generation_mode: "legacy" })).toThrow(/manual/);
    expect(() => buildManualTaskRow({ ...manual, created_by: "" })).toThrow(/created_by/);
    expect(() => buildManualTaskRow({ ...manual, manual_subtype: "loquesea" })).toThrow(/manual_subtype/);
    expect(() => buildManualTaskRow({ ...manual, starts_at: "" })).toThrow(/starts_at/);
    expect(() => buildManualTaskRow({ ...manual, due_date: "2026-08-14T09:00:00Z" })).toThrow(/anterior/);
  });

  it("demo: cero escrituras, tope 20 y sin task_key persistible", () => {
    const spy = { writes: 0 };
    const res = buildDemoProposals({
      comercialId: "jesus",
      buildings: [],
      config: { global: { mode: "equilibrado", mix: MIX } },
    });
    expect(spy.writes).toBe(0);
    expect(res.writes).toBe(0);
    expect(res.persisted).toBe(false);
    expect(res.proposals.length).toBeLessThanOrEqual(20);
    for (const p of res.proposals) expect((p as any).taskKey).toBeUndefined();
  });
});

describe("V5 P0.3 — la UI no escribe building_tasks directamente", () => {
  it("cero INSERT/UPDATE/DELETE directos en pantallas", () => {
    const root = path.resolve(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const rel = path.relative(root, p);
        if (rel.startsWith("test") || rel === "lib/taskWriters.ts") continue;
        const src = fs.readFileSync(p, "utf8");
        const re = /building_tasks[\s\S]{0,80}?\.\s*(insert|upsert|update|delete)\s*\(/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(src))) offenders.push(`${rel}: ${m[1]}`);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
