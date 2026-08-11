/**
 * REPARSEO P0.6 — CONTRATO DE EXCEPCIONES DEL ORQUESTADOR REAL.
 * Se usa el orquestador de producción (orchestrator.ts) con dependencias
 * que LANZAN, para demostrar que ninguna excepción escapa y que los claims
 * ya adquiridos SIEMPRE se liberan por CAS.
 */
import { describe, it, expect } from "vitest";
import { runReparseCycle } from "../../supabase/functions/notas_simples_reparse/orchestrator";

const nota = (id: string) => ({ id, claim_token: `tok-${id}`, attempt_count: 0 });

function baseDeps(over: Partial<any> = {}) {
  const released: string[] = [];
  const deps: any = {
    readState: async () => ({ ok: true as const, pending: false, generation: 3 }),
    claimBatch: async () => ({ rows: [nota("a"), nota("b")], error: null }),
    markPending: async () => ({ ok: true as const, generation: 4 }),
    releaseClaim: async (n: any) => { released.push(n.id); return { ok: true as const, released: true }; },
    processNota: async (n: any) => ({ id: n.id, ok: true }),
    runMatch: async () => ({ status: "ok" as const, data: {} }),
    clearPending: async () => ({ ok: true as const, cleared: true }),
    insertLog: async () => ({ ok: true as const }),
    now: () => 1_000,
    ...over,
  };
  return { deps, released };
}

const contractual = (r: any) => [r.http, r.body.status, r.body.ok, typeof r.body.error_message];

describe("P0.6 · toda excepción es 500/partial trazable", () => {
  it("readState LANZA", async () => {
    const { deps } = baseDeps({ readState: async () => { throw new Error("read boom"); } });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(contractual(r)).toEqual([500, "partial", false, "string"]);
    expect(String(r.body.error_message)).toContain("read boom");
    expect(r.body.match_pending).toBe(true);
  });

  it("markPending LANZA => libera TODOS los claims y 500/partial", async () => {
    const { deps, released } = baseDeps({ markPending: async () => { throw new Error("mark boom"); } });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(contractual(r)).toEqual([500, "partial", false, "string"]);
    expect(String(r.body.error_message)).toContain("mark boom");
    expect(released).toEqual(["a", "b"]);
    expect(r.body.release_ok).toBe(true);
    expect(r.body.match_pending).toBe(true);
  });

  it("markPending ok:false => libera TODOS los claims", async () => {
    const { deps, released } = baseDeps({ markPending: async () => ({ ok: false as const, error: "mark fail" }) });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(r.http).toBe(500);
    expect(released).toEqual(["a", "b"]);
    expect(r.body.release_ok).toBe(true);
  });

  it("una liberación que devuelve 0 filas se reporta y no se traga", async () => {
    const { deps } = baseDeps({
      markPending: async () => { throw new Error("mark boom"); },
      releaseClaim: async (n: any) => (n.id === "b" ? { ok: true as const, released: false } : { ok: true as const, released: true }),
    });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(r.http).toBe(500);
    expect(r.body.release_ok).toBe(false);
    expect(r.body.released).toBe(1);
    expect(String((r.body.release_errors as string[]).join())).toContain("release_cas_miss:b");
  });

  it("una liberación que LANZA no impide liberar el resto", async () => {
    const { deps, released } = baseDeps({
      markPending: async () => ({ ok: false as const, error: "mark fail" }),
      releaseClaim: async (n: any) => {
        if (n.id === "a") throw new Error("release boom");
        released.push(n.id);
        return { ok: true as const, released: true };
      },
    });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(r.http).toBe(500);
    expect(released).toEqual(["b"]);
    expect(String((r.body.release_errors as string[]).join())).toContain("release_exception:a");
  });

  it("clearPending LANZA", async () => {
    const { deps } = baseDeps({ clearPending: async () => { throw new Error("clear boom"); } });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(contractual(r)).toEqual([500, "partial", false, "string"]);
    expect(String(r.body.error_message)).toContain("clear boom");
  });

  it("insertLog LANZA => 500 y el singleton sigue mandando", async () => {
    const { deps } = baseDeps({ insertLog: async () => { throw new Error("log boom"); } });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(contractual(r)).toEqual([500, "partial", false, "string"]);
    expect(String(r.body.error_message)).toContain("log");
  });

  it("notas OK + matching que LANZA => notas finalizadas, pending true, 500", async () => {
    const { deps } = baseDeps({ runMatch: async () => { throw new Error("match boom"); } });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect(contractual(r)).toEqual([500, "partial", false, "string"]);
    expect(r.body.match_pending).toBe(true);
    expect(String(r.body.error_message)).toContain("match boom");
  });

  it("processNota que LANZA no rompe el ciclo", async () => {
    const { deps } = baseDeps({ processNota: async () => { throw new Error("nota boom"); } });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect([500, 200]).toContain(r.http);
    expect(r.body.status).toBeDefined();
  });
});
