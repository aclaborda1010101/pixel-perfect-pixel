/**
 * REPARSEO P0.9 — INTEGRACIÓN CONTRA PostgreSQL EFÍMERO REAL.
 * La ejecuta supabase/tests/reparse_p09_runner.sh (P09_LIVE=1). Sin clúster,
 * la suite queda SKIP EXPLÍCITO: un SKIP nunca cuenta como PASS.
 *
 * Ruta probada de punta a punta con código de PRODUCCIÓN:
 *   handler → claim (RPC real) → parser por offsets → plan de reemplazo →
 *   apply_nota_reparse_plan (RPC real, transacción única).
 * El OWNER sólo crea fixtures y asevera; toda RPC va como service_role.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { processNotaCore } from "../../supabase/functions/notas_simples_reparse/core";
import { handleReparseRequest } from "../../supabase/functions/notas_simples_reparse/handler";
import { buildCanaryText, HECHOS_CANARY, CANARY_DERECHOS } from "./helpers/notaCanaryFixture";

const LIVE = process.env.P09_LIVE === "1";
const d = LIVE ? describe : describe.skip;
const SECRET = "p09-live-internal-secret";

const envFor = (user?: string) => ({
  ...process.env, PGHOST: process.env.P09_PGHOST, PGDATABASE: process.env.P09_PGDATABASE,
  PGUSER: user, PGPASSWORD: "",
});
const run = (user: string | undefined, sql: string) =>
  execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { env: envFor(user) as any, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const owner = (sql: string) => run(process.env.P09_PGOWNER, sql);
const worker = (sql: string) => run(process.env.P09_PGUSER, sql);
const q = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

// --------------------------------------------------------------------------
// Repo REAL del worker: sólo lectura de titulares + la RPC transaccional.
// --------------------------------------------------------------------------
function repoWorker() {
  return {
    listTitulares: async (notaId: string) => {
      try {
        const json = worker(
          `SELECT coalesce(json_agg(t ORDER BY t.id), '[]'::json) FROM public.nota_simple_titulares t WHERE t.nota_simple_id = ${q(notaId)}::uuid`);
        return { rows: JSON.parse(json || "[]"), error: null };
      } catch (e: any) { return { rows: [], error: String(e?.stderr ?? e?.message) }; }
    },
    applyPlan: async (a: any) => {
      const payload = {
        updates: a.updates, inserts: a.inserts, deletes: a.deletes ?? [],
        structured: { ...a.extracted, titulares: a.titulares, completeness: a.completeness, reparse_done: "1" },
        model: a.model,
      };
      try {
        const out = worker(`SELECT public.apply_nota_reparse_plan(${q(a.notaId)}::uuid, ${q(a.claimToken)}::uuid, ${q(JSON.stringify(payload))}::jsonb)`);
        const r = JSON.parse(out);
        return { ok: true, updated: r.updated ?? 0, inserted: r.inserted ?? 0, finalized: !!r.finalized, error: null };
      } catch (e: any) {
        return { ok: false, updated: 0, inserted: 0, finalized: false, error: String(e?.stderr ?? e?.message).slice(0, 400) };
      }
    },
    updateTitular: async () => ({ rows: 0, error: "direct_child_write_forbidden" }),
    insertTitular: async () => ({ rows: 0, error: "direct_child_write_forbidden" }),
    finalizeNota: async () => ({ rows: 0, error: "direct_finalize_forbidden" }),
  } as any;
}

/** El "LLM" devuelve EXACTAMENTE los 66 hechos que el documento prueba. */
const extractor66 = () => async () => ({
  data: {
    titulares: HECHOS_CANARY.map((h) => ({
      nombre: h.nombre, cif_dni: h.dni, porcentaje: h.porcentaje,
      rol: h.derecho, rol_literal: h.derecho === "pleno" ? "PLENO DOMINIO" : h.derecho === "nuda_propiedad" ? "NUDA PROPIEDAD" : "USUFRUCTO VITALICIO",
      evidencia: { cita: h.cita, pagina: 1, ruta: "TITULARIDADES" },
    })),
  },
  model: "test/model",
});

const TEXTO = buildCanaryText();

const seedNota = () =>
  owner(`INSERT INTO public.notas_simples(status, structured_json, raw_pdf_text) VALUES ('listo','{"needs_extract":"1"}'::jsonb, ${q(TEXTO)}) RETURNING id`);

/** Estado forense actual: 29 derechos con porcentajes REDONDEADOS a 2 dec. */
function seedLegacy29(notaId: string) {
  const vals = HECHOS_CANARY.slice(0, 29).map((h) =>
    `(${q(notaId)}::uuid, ${q(h.nombre)}, ${q(h.dni)}, ${h.porcentaje.toFixed(2)}, 'otro'::public.nota_titular_rol, NULL)`).join(",");
  owner(`INSERT INTO public.nota_simple_titulares(nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal) VALUES ${vals}`);
}
const nTit = (id: string) => Number(owner(`SELECT count(*) FROM public.nota_simple_titulares WHERE nota_simple_id=${q(id)}::uuid`));
const sumTit = () => owner(`SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t.id),'')) FROM public.nota_simple_titulares t`);
const sumNotas = () => owner(`SELECT md5(coalesce(string_agg(n::text,'|' ORDER BY n.id),'')) FROM public.notas_simples n`);
const claim = (id: string) =>
  worker(`SELECT claim_token FROM public.reparse_claim_ids(ARRAY[${q(id)}::uuid], 10)`);

const procesar = (notaId: string, token: string) =>
  processNotaCore(
    { repo: repoWorker(), extract: extractor66() as any },
    { notaId, claimToken: token, structured: { needs_extract: "1" }, textoFuente: TEXTO },
  );

d("P0.9 · reemplazo registral real 29 → 66 en PostgreSQL", () => {
  let notaId = "";
  beforeEach(() => {
    owner(`TRUNCATE public.nota_simple_titulares, public.notas_simples CASCADE`);
    notaId = seedNota();
    seedLegacy29(notaId);
  });

  it("29 legacy redondeadas → EXACTAMENTE 66 derechos con precisión de fuente", async () => {
    expect(nTit(notaId)).toBe(29);
    const res = await procesar(notaId, claim(notaId));
    expect([res.ok, res.finalized]).toEqual([true, true]);
    expect(nTit(notaId)).toBe(CANARY_DERECHOS);
    const capas = owner(`SELECT rol::text || ':' || count(*) FROM public.nota_simple_titulares WHERE nota_simple_id=${q(notaId)}::uuid GROUP BY rol ORDER BY 1`).split("\n").sort();
    expect(capas).toEqual(["nuda_propiedad:20", "pleno:38", "usufructo:8"]);
    // Precisión exacta de fuente: nada redondeado a 2 decimales.
    const exactos = Number(owner(`SELECT count(*) FROM public.nota_simple_titulares WHERE nota_simple_id=${q(notaId)}::uuid AND porcentaje <> round(porcentaje, 2)`));
    expect(exactos).toBeGreaterThan(0);
  });

  it("reintento idempotente: sigue en 66 y CERO cambios", async () => {
    await procesar(notaId, claim(notaId));
    const antes = [nTit(notaId), sumTit()];
    owner(`UPDATE public.notas_simples SET claim_token=NULL, claim_expires_at=NULL, structured_json = structured_json - 'reparse_done' WHERE id=${q(notaId)}::uuid`);
    const res = await procesar(notaId, claim(notaId));
    expect(res.ok).toBe(true);
    expect([nTit(notaId), sumTit()]).toEqual(antes);
  });

  it("fallo REAL en el finalize: rollback total (siguen las 29 originales)", async () => {
    const token = claim(notaId);
    owner(`UPDATE public.notas_simples SET structured_json = structured_json || '{"boom":"1"}'::jsonb WHERE id=${q(notaId)}::uuid`);
    const antes = sumTit();
    const res = await procesar(notaId, token);
    expect(res.ok).toBe(false);
    expect(nTit(notaId)).toBe(29);
    expect(sumTit()).toBe(antes);
  });

  it("claim perdido: CERO escrituras", async () => {
    const token = claim(notaId);
    owner(`UPDATE public.notas_simples SET claim_expires_at = now() - interval '1 minute' WHERE id=${q(notaId)}::uuid`);
    const antes = sumTit();
    const res = await procesar(notaId, token);
    expect([res.ok, res.reason]).toEqual([false, "claim_lost"]);
    expect([nTit(notaId), sumTit()]).toEqual([29, antes]);
  });

  it("dos workers sobre la misma nota: sólo uno aplica", async () => {
    const t1 = claim(notaId);
    const t2 = claim(notaId); // el segundo NO obtiene lease vigente
    expect(t2).toBe("");
    const r1 = await procesar(notaId, t1);
    const r2 = await procesar(notaId, t2 || "00000000-0000-0000-0000-000000000000");
    expect([r1.ok, r2.ok]).toEqual([true, false]);
    expect(nTit(notaId)).toBe(CANARY_DERECHOS);
  });
});

d("P0.9 · ids explícitos: conjunto exacto o CERO escrituras", () => {
  const req = (body: unknown, secret = SECRET) =>
    new Request("http://localhost/notas_simples_reparse", {
      method: "POST", headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(body),
    });

  /** sb del worker: sólo RPC reales; ninguna escritura directa. */
  const sb = {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      try {
        let sql = "";
        if (fn === "reparse_claim_ids") {
          const ids = (args.p_ids as string[]) ?? [];
          const list = ids.length ? ids.map((i) => `${q(i)}::uuid`).join(",") : "NULL::uuid";
          sql = `SELECT coalesce(json_agg(r), '[]'::json) FROM (SELECT * FROM public.reparse_claim_ids(ARRAY[${list}], 10)) r`;
        } else if (fn === "reparse_claim_batch") {
          sql = `SELECT coalesce(json_agg(r), '[]'::json) FROM (SELECT * FROM public.reparse_claim_batch(1, 10)) r`;
        } else {
          sql = `SELECT coalesce(json_agg(r), '[]'::json) FROM (SELECT public.${fn}() ) r`;
        }
        return Promise.resolve({ data: JSON.parse(worker(sql) || "[]"), error: null });
      } catch (e: any) {
        return Promise.resolve({ data: null, error: { message: String(e?.stderr ?? e?.message).slice(0, 300) } });
      }
    },
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };
  let procesadas = 0;
  const processOne = async () => { procesadas++; return { ok: true } as any; };

  let a = "", b = "";
  beforeEach(() => {
    procesadas = 0;
    owner(`TRUNCATE public.nota_simple_titulares, public.notas_simples CASCADE`);
    a = seedNota(); b = seedNota();
  });

  it("un id inexistente en el lote ⇒ 4xx/409 y CERO escrituras y CERO notas procesadas", async () => {
    const antes = [sumTit(), sumNotas()];
    const inexistente = "11111111-1111-4111-8111-111111111111";
    const res = await handleReparseRequest(req({ ids: [a, b, inexistente] }), sb, processOne, { internalSecret: SECRET });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(procesadas).toBe(0);
    expect([sumTit(), sumNotas()]).toEqual(antes);
  });

  it("credencial ausente ⇒ 401, sin claim ni escrituras", async () => {
    const antes = [sumTit(), sumNotas()];
    const res = await handleReparseRequest(req({ ids: [a] }, "malo"), sb, processOne, { internalSecret: SECRET });
    expect(res.status).toBe(401);
    expect(procesadas).toBe(0);
    expect([sumTit(), sumNotas()]).toEqual(antes);
  });
});
