/**
 * REPARSEO P0.6 — INTEGRACIÓN CONTRA PostgreSQL EFÍMERO REAL.
 * Ejecutada por supabase/tests/reparse_p06_runner.sh (P06_LIVE=1).
 *
 * Reglas de la suite:
 *  - El OWNER sólo crea esquema y fixtures. TODA RPC productiva se llama
 *    como el rol worker (service_role), con sus permisos reales.
 *  - Nada de simuladores JS: se usan handleReparseRequest y
 *    processNotaWithClaim de producción y las RPC reales.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { handleReparseRequest, processNotaWithClaim } from "../../supabase/functions/notas_simples_reparse/handler";

// P0.8: el endpoint exige credencial verificable también en las pruebas live.
const SECRET = "p06-live-internal-secret";
const LIVE = process.env.P06_LIVE === "1";
const d = LIVE ? describe : describe.skip;

const envFor = (user?: string) => ({
  ...process.env,
  PGHOST: process.env.P06_PGHOST,
  PGDATABASE: process.env.P06_PGDATABASE,
  PGUSER: user,
  PGPASSWORD: "",
});
const run = (user: string | undefined, sql: string) =>
  execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: envFor(user) as any, encoding: "utf8",
  }).trim();

/** Fixtures/aserciones: propietario del esquema. NUNCA ejecuta RPC productiva. */
const owner = (sql: string) => run(process.env.P06_PGOWNER, sql);
/** Worker: emula service_role. Todas las RPC productivas pasan por aquí. */
const worker = (sql: string) => run(process.env.P06_PGUSER, sql);

const SIG: Record<string, Record<string, string>> = {
  reparse_match_state_read: {},
  reparse_mark_match_pending: {},
  reparse_clear_match_pending: { p_expected_generation: "bigint" },
  reparse_claim_batch: { p_limit: "integer", p_lock_minutes: "integer" },
  release_nota_reparse_claim: { p_id: "uuid", p_expected_token: "uuid" },
  reparse_reap_expired_claims: {},
  reparse_fail_nota: {
    p_id: "uuid", p_expected_token: "uuid", p_last_error: "text",
    p_attempt: "integer", p_next_retry_at: "timestamptz", p_dead: "boolean",
  },
  apply_nota_reparse_plan: { p_nota_id: "uuid", p_claim_token: "uuid", p_payload: "jsonb" },
  match_notas_pendientes: {},
  p05_set_switch: { p_k: "text", p_v: "boolean" },
};
const lit = (v: unknown, type: string) => {
  if (v === null || v === undefined) return `NULL::${type}`;
  const raw = type === "jsonb" ? JSON.stringify(v) : String(v);
  return `'${raw.replace(/'/g, "''")}'::${type}`;
};

/** Traza de qué rol ejecutó cada paso: se verifica en los tests. */
const trace: { fn: string; current_user: string }[] = [];

function sbWorker() {
  return {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const sig = SIG[fn] ?? {};
      const params = Object.keys(args).filter((k) => k in sig)
        .map((k) => `${k} := ${lit(args[k], sig[k])}`).join(", ");
      const sql = `SELECT current_user AS __who, coalesce(json_agg(r), '[]'::json) AS __rows FROM (SELECT * FROM public.${fn}(${params})) r`;
      try {
        const [who, json] = worker(sql).split("|");
        trace.push({ fn, current_user: who });
        const rows = JSON.parse(json || "[]") as any[];
        const data = rows.map((r) => {
          const keys = Object.keys(r ?? {});
          return keys.length === 1 ? r[keys[0]] : r;
        });
        return Promise.resolve({ data, error: null });
      } catch (e: any) {
        trace.push({ fn, current_user: String(process.env.P06_PGUSER) });
        return Promise.resolve({ data: null, error: { message: String(e?.stderr ?? e?.message ?? e).slice(0, 400) } });
      }
    },
    from(table: string) {
      return {
        insert(row: any) {
          try {
            if (owner(`SELECT v::text FROM public.p05_switches WHERE k='log_fail'`) === "true") {
              throw new Error("log down (simulado)");
            }
            worker(`INSERT INTO public.${table}(entity, status, error_message, metadatos) VALUES (${lit(row.entity, "text")}, ${lit(row.status, "text")}, ${lit(row.error_message, "text")}, ${lit(row.metadatos ?? {}, "jsonb")})`);
            trace.push({ fn: "log_insert", current_user: String(process.env.P06_PGUSER) });
            return Promise.resolve({ error: null });
          } catch (e: any) {
            return Promise.resolve({ error: { message: String(e?.stderr ?? e?.message) } });
          }
        },
      };
    },
  };
}
const sb = sbWorker();

const seedNota = () =>
  owner(`INSERT INTO public.notas_simples(status, structured_json) VALUES ('listo','{"needs_extract":"1"}'::jsonb) RETURNING id`);
const seedTitular = (notaId: string, nombre = "ANTIGUO") =>
  owner(`INSERT INTO public.nota_simple_titulares(nota_simple_id, nombre_extraido, rol) VALUES ('${notaId}','${nombre}','otro') RETURNING id`);
const plan = (over: any = {}) => ({
  updates: [], inserts: [{ nombre_extraido: "NUEVO TITULAR", rol: "pleno" }],
  structured: { reparse_done: "1" }, raw_pdf_text: "texto", attempt_count: 1, ...over,
});
const titulares = (notaId: string) =>
  Number(owner(`SELECT count(*) FROM public.nota_simple_titulares WHERE nota_simple_id='${notaId}'`));
/** Checksums para demostrar rollback: si algo se coló, cambian. */
const childSum = () => owner(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.nota_simple_titulares t`);
const noteSum = () => owner(`SELECT md5(coalesce(string_agg(n.id::text || coalesce(n.structured_json::text,'') || coalesce(n.raw_pdf_text,''), '|' ORDER BY n.id), '')) FROM public.notas_simples n`);
const claimOne = async () => ((await sb.rpc("reparse_claim_batch", { p_limit: 1, p_lock_minutes: 10 })).data as any[])[0];
const expire = (id: string) => owner(`UPDATE public.notas_simples SET claim_expires_at = now() - interval '1 minute' WHERE id='${id}'`);

d("P0.6 · lease vigente, roles reales y rollback verificado", () => {
  beforeEach(() => {
    trace.length = 0;
    owner("DELETE FROM public.nota_simple_titulares; DELETE FROM public.notas_simples; DELETE FROM public.hubspot_sync_log; UPDATE public.p05_switches SET v=false; UPDATE public.notas_reparse_state SET match_pending=false, generation=0;");
  });

  // ---------- 3) roles ----------
  it("el worker no toca tablas directamente pero sí ejecuta las RPC", () => {
    for (const t of ["notas_simples", "nota_simple_titulares", "notas_reparse_state"]) {
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(`${t}.${p}=${owner(`SELECT has_table_privilege('service_role','public.${t}','${p}')`)}`).toBe(`${t}.${p}=f`);
      }
    }
    expect(owner(`SELECT has_function_privilege('service_role','public.reparse_claim_batch(integer,integer)','EXECUTE')`)).toBe("t");
    expect(owner(`SELECT has_function_privilege('service_role','public.reparse_reap_expired_claims()','EXECUTE')`)).toBe("t");
    expect(owner(`SELECT has_function_privilege('anon','public.reparse_reap_expired_claims()','EXECUTE')`)).toBe("f");
    // acceso directo denegado de verdad, no sólo por catálogo:
    expect(() => worker("SELECT count(*) FROM public.notas_simples")).toThrow();
  });

  // ---------- 2) lease vigente ----------
  it("token EXPIRADO no aplica, no marca retry y no libera", async () => {
    const id = seedNota();
    const n = await claimOne();
    expire(id);

    const ap = await sb.rpc("apply_nota_reparse_plan", { p_nota_id: id, p_claim_token: n.claim_token, p_payload: plan() });
    expect(String(ap.error?.message)).toContain("claim_lost");

    const fail = await sb.rpc("reparse_fail_nota", {
      p_id: id, p_expected_token: n.claim_token, p_last_error: "x", p_attempt: 1, p_next_retry_at: null, p_dead: false,
    });
    expect((fail.data as any[])[0]).toBe(false);
    expect(owner(`SELECT attempt_count FROM public.notas_simples WHERE id='${id}'`)).toBe("0");

    const rel = await sb.rpc("release_nota_reparse_claim", { p_id: id, p_expected_token: n.claim_token });
    expect((rel.data as any[])[0] ?? null).toBeNull();
    // sigue con el token viejo: sólo el reaper server-side puede limpiarlo
    expect(owner(`SELECT claim_token='${n.claim_token}' FROM public.notas_simples WHERE id='${id}'`)).toBe("t");
  });

  it("el reaper server-side limpia SÓLO lo caducado y no genera trabajo", async () => {
    const viejo = seedNota();
    const vivo = seedNota();
    await sb.rpc("reparse_claim_batch", { p_limit: 2, p_lock_minutes: 10 });
    expire(viejo);
    const r = await sb.rpc("reparse_reap_expired_claims");
    expect((r.data as any[])[0]).toBe(1);
    expect(owner(`SELECT claim_token IS NULL FROM public.notas_simples WHERE id='${viejo}'`)).toBe("t");
    expect(owner(`SELECT claim_token IS NOT NULL FROM public.notas_simples WHERE id='${vivo}'`)).toBe("t");
    expect(titulares(viejo)).toBe(0);
  });

  it("un token viejo nunca pisa el claim nuevo (fail ni release)", async () => {
    const id = seedNota();
    const viejo = await claimOne();
    expire(id);
    await sb.rpc("reparse_reap_expired_claims");
    const nuevo = await claimOne();
    expect(nuevo.claim_token).not.toBe(viejo.claim_token);

    expect(((await sb.rpc("reparse_fail_nota", { p_id: id, p_expected_token: viejo.claim_token, p_last_error: "x", p_attempt: 3, p_next_retry_at: null, p_dead: true })).data as any[])[0]).toBe(false);
    expect(((await sb.rpc("release_nota_reparse_claim", { p_id: id, p_expected_token: viejo.claim_token })).data as any[])[0] ?? null).toBeNull();
    expect(owner(`SELECT claim_token='${nuevo.claim_token}' AND dead_letter=false FROM public.notas_simples WHERE id='${id}'`)).toBe("t");
  });

  // ---------- 4) concurrencia real ----------
  it("dos conexiones REALMENTE solapadas: sólo una reclama", async () => {
    seedNota();
    const barrera = owner("SELECT (now() + interval '1.2 second')::text");
    const sql = `SELECT pg_sleep(GREATEST(0, extract(epoch from (timestamptz '${barrera}' - clock_timestamp())))); SELECT count(*) FROM public.reparse_claim_batch(1, 10)`;
    const go = () => new Promise<string>((res) => {
      execFile("psql", ["-X", "-A", "-t", "-q", "-c", sql], { env: envFor(process.env.P06_PGUSER) as any },
        (_e, out) => res(String(out).trim().split("\n").pop() ?? "0"));
    });
    const [a, b] = await Promise.all([go(), go()]);
    expect([a, b].map(Number).sort()).toEqual([0, 1]);
  });

  // ---------- 4) rollback con fallo inyectado real ----------
  it("fallo en el SEGUNDO update => rollback total, checksums intactos", async () => {
    const id = seedNota();
    const otra = seedNota();
    const mio = seedTitular(id);
    const ajeno = seedTitular(otra, "AJENO");
    const n = ((await sb.rpc("reparse_claim_batch", { p_limit: 2, p_lock_minutes: 10 })).data as any[]).find((x: any) => x.id === id);
    const c0 = childSum(), s0 = noteSum();
    const r = await sb.rpc("apply_nota_reparse_plan", {
      p_nota_id: id, p_claim_token: n.claim_token,
      p_payload: plan({ updates: [{ id: mio, patch: { rol: "pleno" } }, { id: ajeno, patch: { rol: "pleno" } }] }),
    });
    expect(String(r.error?.message)).toContain("titular_update_fail");
    expect([childSum(), noteSum()]).toEqual([c0, s0]);
  });

  it("fallo en el SEGUNDO insert => rollback total, checksums intactos", async () => {
    const id = seedNota();
    const n = await claimOne();
    const c0 = childSum(), s0 = noteSum();
    const r = await sb.rpc("apply_nota_reparse_plan", {
      p_nota_id: id, p_claim_token: n.claim_token,
      p_payload: plan({ inserts: [{ nombre_extraido: "UNO", rol: "pleno" }, { nombre_extraido: null, rol: "pleno" }] }),
    });
    expect(r.error).toBeTruthy();
    expect([childSum(), noteSum()]).toEqual([c0, s0]);
  });

  it("fallo en el FINALIZE => rollback total, checksums intactos", async () => {
    const id = seedNota();
    const n = await claimOne();
    const c0 = childSum(), s0 = noteSum();
    const r = await sb.rpc("apply_nota_reparse_plan", {
      p_nota_id: id, p_claim_token: n.claim_token, p_payload: plan({ structured: { boom: "1" } }),
    });
    expect(String(r.error?.message)).toContain("p06_boom");
    expect([childSum(), noteSum()]).toEqual([c0, s0]);
  });

  // ---------- 3) handler real ----------
  it("handler REAL: request → claim → processNotaWithClaim → apply → matching → clear", async () => {
    const id = seedNota();
    const processOne = async (client: any, nota: any, token: string) => {
      const r = await client.rpc("apply_nota_reparse_plan", { p_nota_id: nota.id, p_claim_token: token, p_payload: plan() });
      return r.error ? { id: nota.id, ok: false, reason: r.error.message } : { id: nota.id, ok: true };
    };
    const res = await handleReparseRequest(
      new Request("http://local/reparse", { method: "POST", headers: { "x-internal-secret": SECRET }, body: JSON.stringify({ limit: 3 }) }),
      sb as any, processOne as any, { internalSecret: SECRET });
    const body = await res.json();
    expect([res.status, body.status, body.match_pending]).toEqual([200, "ok", false]);
    expect(titulares(id)).toBe(1);
    expect(owner("SELECT match_pending FROM public.notas_reparse_state")).toBe("f");
    // cada paso corrió como worker
    const pasos = trace.map((t) => t.fn);
    expect(pasos).toContain("reparse_claim_batch");
    expect(pasos).toContain("reparse_clear_match_pending");
    for (const t of trace) expect(t.current_user).toBe(process.env.P06_PGUSER);
  });

  it("processNotaWithClaim real cierra el intento fallido por RPC CAS", async () => {
    const id = seedNota();
    const n = await claimOne();
    const r: any = await processNotaWithClaim(sb as any, n, async () => ({ id, ok: false, reason: "pdf_ilegible" }));
    expect(r.ok).toBe(false);
    expect(r.retry_state_fail).toBeUndefined();       // el CAS aplicó
    expect(owner(`SELECT attempt_count::text || '|' || (claim_token IS NULL)::text FROM public.notas_simples WHERE id='${id}'`)).toBe("1|true");
  });

  it("handler: todas las notas OK + matching caído => 500/partial y pendiente", async () => {
    const id = seedNota();
    await sb.rpc("p05_set_switch", { p_k: "match_fail", p_v: true });
    const processOne = async (client: any, nota: any, token: string) => {
      await client.rpc("apply_nota_reparse_plan", { p_nota_id: nota.id, p_claim_token: token, p_payload: plan() });
      return { id: nota.id, ok: true };
    };
    const res = await handleReparseRequest(
      new Request("http://local/reparse", { method: "POST", headers: { "x-internal-secret": SECRET }, body: "{}" }), sb as any, processOne as any, { internalSecret: SECRET });
    const body = await res.json();
    expect([res.status, body.status, body.match_pending]).toEqual([500, "partial", true]);
    expect(titulares(id)).toBe(1);
    expect(owner("SELECT match_pending FROM public.notas_reparse_state")).toBe("t");
  });
});
