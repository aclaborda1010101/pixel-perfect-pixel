import { describe, it, expect } from "vitest";
import {
  runReparseCycle,
  type CycleDeps,
  type StateRead,
} from "../../supabase/functions/notas_simples_reparse/orchestrator";
import {
  processNotaCore,
  runMatching,
  applyPlanReason,
  type NotaRepo,
  type ApplyPlanArgs,
} from "../../supabase/functions/notas_simples_reparse/core";

// ---------------------------------------------------------------------------
// Estado singleton en memoria con la MISMA semántica que la migración:
// mark => generation+1 y pending=true; clear(expected) => CAS.
// ---------------------------------------------------------------------------
function estadoSingleton(init: { pending?: boolean; generation?: number } = {}) {
  const s = { pending: init.pending ?? false, generation: init.generation ?? 0 };
  const fallos = { read: false, mark: false, clear: false };
  return {
    s,
    fallos,
    async read(): Promise<StateRead> {
      if (fallos.read) return { ok: false, error: "read boom" };
      return { ok: true, pending: s.pending, generation: s.generation };
    },
    async mark() {
      if (fallos.mark) return { ok: false as const, error: "mark boom" };
      s.generation += 1;
      s.pending = true;
      return { ok: true as const, generation: s.generation };
    },
    async clear(expected: number) {
      if (fallos.clear) return { ok: false as const, error: "clear boom" };
      if (expected !== s.generation) return { ok: true as const, cleared: false };
      s.pending = false;
      return { ok: true as const, cleared: true };
    },
  };
}

function deps(over: Partial<CycleDeps> & { estado: ReturnType<typeof estadoSingleton> }): CycleDeps & {
  logs: any[];
} {
  const logs: any[] = [];
  const base: CycleDeps = {
    readState: () => over.estado.read(),
    markPending: () => over.estado.mark(),
    clearPending: (g) => over.estado.clear(g),
    claimBatch: async () => ({ rows: [], error: null }),
    processNota: async (n: any) => ({ id: n.id, ok: true }),
    runMatch: async () => ({ status: "ok", reason: "rpc_ok", pending: false, data: { matched: 1 }, error: null }),
    insertLog: async (e) => { logs.push(e); return { error: null }; },
  };
  return Object.assign({}, base, over, { logs }) as any;
}

const nota = (id: string) => ({ id, claimed_at: null });

describe("REPARSEO P0.4 · resultado honesto y estado atómico", () => {
  it("todas las notas OK + matching fallido => HTTP 500 partial con match_error, notas finalizadas", async () => {
    const estado = estadoSingleton();
    const finalizadas: string[] = [];
    const d = deps({
      estado,
      claimBatch: async () => ({ rows: [nota("a"), nota("b")], error: null }),
      processNota: async (n: any) => { finalizadas.push(n.id); return { id: n.id, ok: true }; },
      runMatch: async () => ({ status: "error", reason: "rpc_error", pending: true, data: null, error: "deadlock" }),
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect(finalizadas).toEqual(["a", "b"]);
    expect(r.http).toBe(500);
    expect(r.body.status).toBe("partial");
    expect(r.body.ok).toBe(false);
    expect(String(r.body.error_message)).toContain("match_error:deadlock");
    expect(r.body.match_pending).toBe(true);
    expect(estado.s.pending).toBe(true);
  });

  it("fallo de LECTURA de estado => 0 notas tocadas y HTTP 500", async () => {
    const estado = estadoSingleton();
    estado.fallos.read = true;
    let claimed = 0;
    let procesadas = 0;
    const d = deps({
      estado,
      claimBatch: async () => { claimed++; return { rows: [nota("a")], error: null }; },
      processNota: async (n: any) => { procesadas++; return { id: n.id, ok: true }; },
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect([claimed, procesadas]).toEqual([0, 0]);
    expect([r.http, r.body.status]).toEqual([500, "partial"]);
    expect(String(r.body.error_message)).toContain("state_read_fail");
  });

  it("fallo de ESCRITURA de estado (mark) => 0 notas tocadas, claims liberados y HTTP 500", async () => {
    const estado = estadoSingleton();
    estado.fallos.mark = true;
    let procesadas = 0;
    let liberados = 0;
    const d = deps({
      estado,
      claimBatch: async () => ({ rows: [nota("a"), nota("b")], error: null }),
      processNota: async (n: any) => { procesadas++; return { id: n.id, ok: true }; },
      releaseClaim: async () => { liberados++; return { ok: true, released: true }; },
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect(procesadas).toBe(0);
    expect(liberados).toBe(2);
    expect([r.http, r.body.status]).toEqual([500, "partial"]);
    expect(String(r.body.error_message)).toContain("state_mark_fail");
  });

  it("fallo del INSERT del log => HTTP 500 y el estado singleton queda intacto", async () => {
    const estado = estadoSingleton();
    const d = deps({
      estado,
      claimBatch: async () => ({ rows: [nota("a")], error: null }),
      insertLog: async () => ({ error: "log down" }),
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect([r.http, r.body.status]).toEqual([500, "partial"]);
    expect(String(r.body.error_message)).toContain("log_insert_fail");
    // El matching fue OK: el estado se limpió por CAS antes del log.
    expect(estado.s.pending).toBe(false);
    expect(estado.s.generation).toBe(1);
  });

  it("RPC OK + CAS limpia el pendiente de ESTA generación", async () => {
    const estado = estadoSingleton({ pending: true, generation: 7 });
    const d = deps({ estado, claimBatch: async () => ({ rows: [nota("a")], error: null }) });
    const r = await runReparseCycle(d, { limit: 5 });
    expect(estado.s.generation).toBe(8);
    expect(estado.s.pending).toBe(false);
    expect([r.http, r.body.match_pending, r.body.cas_conflict]).toEqual([200, false, false]);
  });

  it("CAS en conflicto: un éxito VIEJO no borra un pendiente NUEVO", async () => {
    const estado = estadoSingleton();
    const d = deps({
      estado,
      claimBatch: async () => ({ rows: [nota("a")], error: null }),
      // durante el matching, otra ejecución marca un pendiente nuevo
      runMatch: async () => {
        await estado.mark();
        return { status: "ok", reason: "rpc_ok", pending: false, data: null, error: null };
      },
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect(r.body.cas_conflict).toBe(true);
    expect(r.body.match_pending).toBe(true);
    expect(estado.s.pending).toBe(true);
  });

  it("dos workers solapados: el segundo mark gana y el primer clear no limpia", async () => {
    const estado = estadoSingleton();
    const w1 = await estado.mark();
    const w2 = await estado.mark();
    expect(await estado.clear(w1.generation)).toEqual({ ok: true, cleared: false });
    expect(estado.s.pending).toBe(true);
    expect(await estado.clear(w2.generation)).toEqual({ ok: true, cleared: true });
    expect(estado.s.pending).toBe(false);
  });

  it("ejecución SIN matching (todas fallan) jamás escribe false", async () => {
    const estado = estadoSingleton();
    let matchCalls = 0;
    const d = deps({
      estado,
      claimBatch: async () => ({ rows: [nota("a")], error: null }),
      processNota: async (n: any) => ({ id: n.id, ok: false, reason: "llm_fail" }),
      runMatch: async () => { matchCalls++; return { status: "ok", reason: "rpc_ok", pending: false, data: null, error: null }; },
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect(matchCalls).toBe(0);
    expect(estado.s.pending).toBe(true);
    expect([r.http, r.body.match_pending]).toEqual([500, true]);
  });

  it("drenado: pending=true reintenta una vez; pending=false es no-op", async () => {
    const estado = estadoSingleton({ pending: true, generation: 3 });
    let calls = 0;
    const d = deps({
      estado,
      runMatch: async () => { calls++; return { status: "ok", reason: "rpc_ok", pending: false, data: { matched: 4 }, error: null }; },
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect([calls, r.http, r.body.drained, r.body.match_pending]).toEqual([1, 200, true, false]);
    expect(estado.s.pending).toBe(false);

    const estado2 = estadoSingleton({ pending: false, generation: 3 });
    let calls2 = 0;
    const d2 = deps({ estado: estado2, runMatch: async () => { calls2++; return { status: "ok", reason: "rpc_ok", pending: false, data: null, error: null }; } });
    const r2 = await runReparseCycle(d2, { limit: 5 });
    expect([calls2, r2.http, r2.body.match_pending]).toEqual([0, 200, false]);
  });

  it("drenado con matching fallido conserva true y responde 500", async () => {
    const estado = estadoSingleton({ pending: true, generation: 2 });
    const d = deps({
      estado,
      runMatch: async () => ({ status: "error", reason: "rpc_error", pending: true, data: null, error: "timeout" }),
    });
    const r = await runReparseCycle(d, { limit: 5 });
    expect([r.http, r.body.match_pending]).toEqual([500, true]);
    expect(estado.s.pending).toBe(true);
  });

  it("drenado con error de lectura de estado => 500 y no intenta matching", async () => {
    const estado = estadoSingleton();
    estado.fallos.read = true;
    let calls = 0;
    const d = deps({ estado, runMatch: async () => { calls++; return { status: "ok", reason: "rpc_ok", pending: false, data: null, error: null }; } });
    const r = await runReparseCycle(d, { limit: 5 });
    expect([calls, r.http]).toEqual([0, 500]);
  });

  it("el log es auditoría: un log con match_pending falso no cambia el estado leído", async () => {
    const estado = estadoSingleton({ pending: true, generation: 5 });
    const d = deps({
      estado,
      insertLog: async () => ({ error: null }),
      runMatch: async () => ({ status: "error", reason: "rpc_error", pending: true, data: null, error: "x" }),
    });
    await runReparseCycle(d, { limit: 5 });
    const leido = await estado.read();
    expect(leido).toEqual({ ok: true, pending: true, generation: 5 });
  });
});

// ---------------------------------------------------------------------------
// Persistencia claim-scoped: transacción todo-o-nada (stand-in de la RPC).
// ---------------------------------------------------------------------------
type Fila = { id: string; nota_simple_id: string; nombre_extraido: string; cif_dni: string | null; porcentaje: number | null; rol: string; rol_literal: string | null; evidencia: unknown };

function dbTransaccional(opts: {
  claim: string | null;
  titulares?: Fila[];
  falloEn?: "update2" | "insert2" | "finalize";
}) {
  const db = {
    claim: opts.claim,
    titulares: [...(opts.titulares ?? [])],
    finalizado: false,
    structured: null as unknown,
  };
  let seq = 0;
  const applyPlan = async (a: ApplyPlanArgs) => {
    const snapshot = { claim: db.claim, titulares: db.titulares.map((t) => ({ ...t })), finalizado: db.finalizado, structured: db.structured };
    const rollback = () => Object.assign(db, snapshot, { titulares: snapshot.titulares.map((t) => ({ ...t })) });
    try {
      if (db.claim == null || db.claim !== a.claimToken) throw new Error("claim_lost: sin claim vigente");
      let nUpd = 0;
      for (const u of a.updates) {
        nUpd++;
        if (opts.falloEn === "update2" && nUpd === 2) throw new Error("titular_update_fail: 0 filas");
        const f = db.titulares.find((t) => t.id === u.id && t.nota_simple_id === a.notaId);
        if (!f) throw new Error("titular_update_fail: 0 filas");
        Object.assign(f, u.patch);
      }
      let nIns = 0;
      for (const row of a.inserts) {
        nIns++;
        if (opts.falloEn === "insert2" && nIns === 2) throw new Error("titular_insert_fail: 0 filas");
        db.titulares.push({ ...(row as any), id: `new-${++seq}` });
      }
      if (opts.falloEn === "finalize") throw new Error("finalize_fail: 0 filas");
      db.structured = { titulares: a.titulares };
      db.finalizado = true;
      db.claim = null;
      return { ok: true, updated: a.updates.length, inserted: a.inserts.length, finalized: true, error: null };
    } catch (e) {
      rollback();
      return { ok: false, updated: 0, inserted: 0, finalized: false, error: String((e as Error).message) };
    }
  };
  return { db, applyPlan };
}

const evid = (cita: string, pagina = 1) => ({ fuentes: [{ cita, pagina, ruta: "SECCION A" }] });
// P0.8: la cita ancla identidad + derecho + porcentaje en el mismo literal.
const titularLLM = (nombre: string, _cita?: string) => ({
  nombre, cif_dni: null, porcentaje: 100, rol: "pleno", rol_literal: "PLENO DOMINIO",
  evidencia: {
    cita: `TITULAR: ${nombre} PARTICIPACION: 100% del pleno dominio`,
    pagina: 1, ruta: "SECCION A",
  },
});

function repoDe(tx: ReturnType<typeof dbTransaccional>, existentes: Fila[]): NotaRepo {
  return {
    listTitulares: async () => ({ rows: existentes as any, error: null }),
    applyPlan: tx.applyPlan,
    updateTitular: async () => ({ rows: 0, error: "direct_child_write_forbidden" }),
    insertTitular: async () => ({ rows: 0, error: "direct_child_write_forbidden" }),
    finalizeNota: async () => ({ rows: 0, error: "direct_finalize_forbidden" }),
  };
}

const extractor = (titulares: any[]) => async () => ({ data: { titulares }, model: "test/model" });

describe("REPARSEO P0.4 · persistencia claim-scoped transaccional", () => {
  it("plan OK: aplica hijos y finaliza dentro del claim", async () => {
    const tx = dbTransaccional({ claim: "T1" });
    const res = await processNotaCore(
      { repo: repoDe(tx, []), extract: extractor([titularLLM("ANA", "consta ANA")]) },
      { notaId: "n1", claimToken: "T1", structured: {} },
    );
    expect([res.ok, res.finalized, res.inserted]).toEqual([true, true, 1]);
    expect(tx.db.titulares).toHaveLength(1);
    expect(tx.db.finalizado).toBe(true);
  });

  it("claim perdido: CERO cambios en titulares y sin finalizar", async () => {
    const tx = dbTransaccional({ claim: "OTRO" });
    const res = await processNotaCore(
      { repo: repoDe(tx, []), extract: extractor([titularLLM("ANA", "consta ANA")]) },
      { notaId: "n1", claimToken: "T1", structured: {} },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("claim_lost");
    expect(tx.db.titulares).toHaveLength(0);
    expect(tx.db.finalizado).toBe(false);
  });

  it("fallo en el segundo INSERT: rollback total (ni el primero persiste)", async () => {
    const tx = dbTransaccional({ claim: "T1", falloEn: "insert2" });
    const res = await processNotaCore(
      { repo: repoDe(tx, []), extract: extractor([titularLLM("ANA", "consta ANA"), titularLLM("LUIS", "consta LUIS")]) },
      { notaId: "n1", claimToken: "T1", structured: {} },
    );
    expect(res.reason).toBe("titular_insert_fail");
    expect(tx.db.titulares).toHaveLength(0);
    expect(tx.db.finalizado).toBe(false);
    expect(tx.db.claim).toBe("T1");
  });

  it("fallo en el segundo UPDATE: rollback total (el primero no queda modificado)", async () => {
    const existentes: Fila[] = [
      { id: "r1", nota_simple_id: "n1", nombre_extraido: "ANA", cif_dni: null, porcentaje: 100, rol: "otro", rol_literal: null, evidencia: null },
      { id: "r2", nota_simple_id: "n1", nombre_extraido: "LUIS", cif_dni: null, porcentaje: 100, rol: "otro", rol_literal: null, evidencia: null },
    ];
    const tx = dbTransaccional({ claim: "T1", titulares: existentes, falloEn: "update2" });
    const res = await processNotaCore(
      { repo: repoDe(tx, existentes), extract: extractor([titularLLM("ANA", "consta ANA"), titularLLM("LUIS", "consta LUIS")]) },
      { notaId: "n1", claimToken: "T1", structured: {} },
    );
    expect(res.reason).toBe("titular_update_fail");
    expect(tx.db.titulares.map((t) => t.rol)).toEqual(["otro", "otro"]);
    expect(tx.db.finalizado).toBe(false);
  });

  it("fallo en el FINALIZE: rollback de los hijos ya aplicados", async () => {
    const tx = dbTransaccional({ claim: "T1", falloEn: "finalize" });
    const res = await processNotaCore(
      { repo: repoDe(tx, []), extract: extractor([titularLLM("ANA", "consta ANA")]) },
      { notaId: "n1", claimToken: "T1", structured: {} },
    );
    expect(res.reason).toBe("finalize_fail");
    expect(tx.db.titulares).toHaveLength(0);
    expect(tx.db.finalizado).toBe(false);
  });

  it("worker obsoleto no puede mutar titulares de una nota ya liberada", async () => {
    const tx = dbTransaccional({ claim: "T1" });
    await processNotaCore(
      { repo: repoDe(tx, []), extract: extractor([titularLLM("ANA", "consta ANA")]) },
      { notaId: "n1", claimToken: "T1", structured: {} },
    );
    const antes = tx.db.titulares.length;
    const stale = await processNotaCore(
      { repo: repoDe(tx, []), extract: extractor([titularLLM("FALSO", "consta FALSO")]) },
      { notaId: "n1", claimToken: "T1", structured: {} },
    );
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("claim_lost");
    expect(tx.db.titulares).toHaveLength(antes);
  });

  it("applyPlanReason traduce los errores de la RPC", () => {
    expect(applyPlanReason("claim_lost: nota x")).toBe("claim_lost");
    expect(applyPlanReason("titular_update_fail: 0 filas")).toBe("titular_update_fail");
    expect(applyPlanReason("titular_insert_fail: 0")).toBe("titular_insert_fail");
    expect(applyPlanReason("finalize_fail: 0")).toBe("finalize_fail");
    expect(applyPlanReason("otra cosa")).toBe("apply_plan_fail");
  });

  it("runMatching sigue distinguiendo error y excepción", async () => {
    expect((await runMatching(async () => { throw new Error("boom"); })).status).toBe("error");
    expect((await runMatching(async () => ({ data: 1 }))).status).toBe("ok");
  });

  it("ciclo real: nota transaccional OK + matching OK limpia el estado", async () => {
    const estado = estadoSingleton();
    const tx = dbTransaccional({ claim: "T1" });
    const d = deps({
      estado,
      claimBatch: async () => ({ rows: [nota("n1")], error: null }),
      processNota: async () => {
        const res = await processNotaCore(
          { repo: repoDe(tx, []), extract: extractor([titularLLM("ANA", "consta ANA")]) },
          { notaId: "n1", claimToken: "T1", structured: {} },
        );
        return { id: "n1", ok: res.ok, reason: res.reason };
      },
    });
    const r = await runReparseCycle(d, { limit: 1 });
    expect([r.http, r.body.match_pending]).toEqual([200, false]);
    expect(tx.db.finalizado).toBe(true);
    expect(estado.s.pending).toBe(false);
  });
});
