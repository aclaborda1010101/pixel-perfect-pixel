/**
 * REPARSEO P0.11 — INTEGRACIÓN CONTRA PostgreSQL EFÍMERO REAL.
 * La ejecuta supabase/tests/reparse_p11_runner.sh (P11_LIVE=1).
 * Sin clúster => SKIP EXPLÍCITO; un SKIP nunca es PASS.
 * Ruta real: handler → claim → parser por anclas → plan → apply_nota_reparse_plan.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { processNotaCore } from "../../supabase/functions/notas_simples_reparse/core";
import { buildCanaryP11, HECHOS_P11, P11_DERECHOS } from "./helpers/notaCanaryFixtureP11";

const LIVE = process.env.P11_LIVE === "1";
const d = LIVE ? describe : describe.skip;

const envFor = (user?: string) => ({
  ...process.env, PGHOST: process.env.P11_PGHOST, PGDATABASE: process.env.P11_PGDATABASE,
  PGUSER: user, PGPASSWORD: "",
});
const run = (user: string | undefined, sql: string) =>
  execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { env: envFor(user) as any, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const owner = (sql: string) => run(process.env.P11_PGOWNER, sql);
const worker = (sql: string) => run(process.env.P11_PGUSER, sql);
const q = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;

const TEXTO = buildCanaryP11();

function repoWorker() {
  return {
    listTitulares: async (notaId: string) => {
      try {
        const json = worker(`SELECT coalesce(json_agg(t ORDER BY t.id), '[]'::json) FROM public.nota_simple_titulares t WHERE t.nota_simple_id = ${q(notaId)}::uuid`);
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

const extractor66 = () => async () => ({
  data: {
    titulares: HECHOS_P11.map((h) => ({
      nombre: h.nombre, cif_dni: h.doc, porcentaje: h.porcentaje, rol: h.derecho,
      rol_literal: h.derecho === "pleno" ? "PLENO DOMINIO" : h.derecho === "nuda_propiedad" ? "NUDA PROPIEDAD" : "USUFRUCTO",
      evidencia: { cita: `${h.nombre ?? ""} PARTICIPACION: ${h.literal} ${h.derecho}`, pagina: 1, ruta: "TITULARIDADES" },
    })),
  },
  model: "test/model",
});

const seedNota = () =>
  owner(`INSERT INTO public.notas_simples(status, structured_json, raw_pdf_text) VALUES ('listo','{"needs_extract":"1"}'::jsonb, ${q(TEXTO)}) RETURNING id`);

/** Las 29 filas reales: 27 claves identidad+derecho + grupos 1,17/3,5 y 0,33/1,04. */
function seedLegacy29(notaId: string) {
  const base = HECHOS_P11.slice(0, 27);
  const legacy = [...base, { ...base[0], porcentaje: 3.5 }, { ...base[2], porcentaje: 1.04 }];
  const vals = legacy.map((h, i) =>
    `(${q(notaId)}::uuid, ${q(h.nombre ?? "")}, ${h.doc ? q(h.doc) : "NULL"}, ${(i === 27 ? 1.17 : i === 28 ? 0.33 : Number(h.porcentaje.toFixed(2)))}, 'otro'::public.nota_titular_rol, 'pleno dominio')`).join(",");
  owner(`INSERT INTO public.nota_simple_titulares(nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal) VALUES ${vals}`);
}

const nTit = (id: string) => Number(owner(`SELECT count(*) FROM public.nota_simple_titulares WHERE nota_simple_id=${q(id)}::uuid`));
const sumTit = (id: string) => owner(`SELECT md5(coalesce(string_agg(t::text,'|' ORDER BY t.id),'')) FROM public.nota_simple_titulares t WHERE t.nota_simple_id=${q(id)}::uuid`);

const claim = (id: string) => worker(`SELECT claim_token FROM public.reparse_claim_ids(ARRAY[${q(id)}::uuid], 10)`);
const procesar = (notaId: string, token: string) =>
  processNotaCore({ repo: repoWorker(), extract: extractor66() as any },
    { notaId, claimToken: token, structured: { needs_extract: "1" }, textoFuente: TEXTO });

d("P0.11 · 29 → 66 real sobre el raw del canario", () => {
  let notaId = "", otra = "";
  beforeEach(() => {
    owner(`TRUNCATE public.nota_simple_titulares, public.notas_simples CASCADE`);
    notaId = seedNota();
    otra = seedNota();
    seedLegacy29(notaId);
    seedLegacy29(otra);
  });

  it("29 → 66 con distribución 38/20/8 y otras notas intactas", async () => {
    expect(nTit(notaId)).toBe(29);
    const intacta = sumTit(otra);
    const res = await procesar(notaId, claim(notaId));
    expect([res.ok, res.finalized]).toEqual([true, true]);
    expect(nTit(notaId)).toBe(P11_DERECHOS);
    const capas = owner(`SELECT rol::text || ':' || count(*) FROM public.nota_simple_titulares WHERE nota_simple_id=${q(notaId)}::uuid GROUP BY rol ORDER BY 1`).split("\n").sort();
    expect(capas).toEqual(["nuda_propiedad:20", "pleno:38", "usufructo:8"]);
    expect(sumTit(otra)).toBe(intacta);
    expect(nTit(otra)).toBe(29);
    const exactos = Number(owner(`SELECT count(*) FROM public.nota_simple_titulares WHERE nota_simple_id=${q(notaId)}::uuid AND porcentaje <> round(porcentaje,2)`));
    expect(exactos).toBeGreaterThan(0);
  });

  it("retry: 66 y CERO cambios", async () => {
    await procesar(notaId, claim(notaId));
    const antes = [nTit(notaId), sumTit(notaId)];
    owner(`UPDATE public.notas_simples SET claim_token=NULL, claim_expires_at=NULL, structured_json = structured_json - 'reparse_done' WHERE id=${q(notaId)}::uuid`);
    const res = await procesar(notaId, claim(notaId));
    expect(res.ok).toBe(true);
    expect([nTit(notaId), sumTit(notaId)]).toEqual(antes);
  });

  it("dos workers reales: sólo uno aplica y el set final es 66", async () => {
    const t1 = claim(notaId);
    const t2 = claim(notaId);
    expect(t2).toBe("");
    const r1 = await procesar(notaId, t1);
    const r2 = await procesar(notaId, t2 || "00000000-0000-0000-0000-000000000000");
    expect([r1.ok, r2.ok]).toEqual([true, false]);
    expect(nTit(notaId)).toBe(P11_DERECHOS);
  });

  it("claim perdido: rollback total, siguen las 29", async () => {
    const token = claim(notaId);
    owner(`UPDATE public.notas_simples SET claim_expires_at = now() - interval '1 minute' WHERE id=${q(notaId)}::uuid`);
    const antes = sumTit(notaId);
    const res = await procesar(notaId, token);
    expect([res.ok, res.reason]).toEqual([false, "claim_lost"]);
    expect([nTit(notaId), sumTit(notaId)]).toEqual([29, antes]);
  });
});
