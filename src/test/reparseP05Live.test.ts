/**
 * REPARSEO P0.5 — SUITE DE INTEGRACIÓN CONTRA PostgreSQL EFÍMERO REAL.
 * Se ejecuta desde supabase/tests/reparse_p05_runner.sh (P05_LIVE=1).
 * No hay simuladores JS de la lógica SQL: cada aserción llama a las RPC
 * REALES creadas por las migraciones pendientes, a través del adaptador
 * de producción (deps.ts) y del ciclo real (orchestrator.ts).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createReparseDeps } from "../../supabase/functions/notas_simples_reparse/deps";
import { runReparseCycle } from "../../supabase/functions/notas_simples_reparse/orchestrator";

const LIVE = process.env.P05_LIVE === "1";
const d = LIVE ? describe : describe.skip;

const envFor = (user?: string) => ({
  ...process.env,
  PGHOST: process.env.P05_PGHOST,
  PGDATABASE: process.env.P05_PGDATABASE,
  PGUSER: user,
  PGPASSWORD: "",
});

function run(user: string | undefined, sql: string): string {
  return execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: envFor(user) as any,
    encoding: "utf8",
  }).trim();
}

/** Fixtures y aserciones: rol propietario (el worker NO tiene estos permisos). */
const psql = (sql: string) => run(process.env.P05_PGOWNER, sql);
/** Todo lo que hace el worker pasa por service_role, con sus permisos reales. */
const psqlWorker = (sql: string) => run(process.env.P05_PGUSER, sql);

// Tipos exactos de cada parámetro: el token viaja SIEMPRE como uuid tipado.
const SIG: Record<string, Record<string, string>> = {
  reparse_match_state_read: {},
  reparse_mark_match_pending: {},
  reparse_clear_match_pending: { p_expected_generation: "bigint" },
  reparse_claim_batch: { p_limit: "integer", p_lock_minutes: "integer" },
  release_nota_reparse_claim: { p_id: "uuid", p_expected_token: "uuid" },
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

/** Cliente mínimo REAL: cada rpc es una llamada SQL a la función de la BD. */
function sbLive() {
  return {
    rpc(fn: string, args: Record<string, unknown> = {}) {
      const sig = SIG[fn] ?? {};
      const params = Object.keys(args)
        .filter((k) => k in sig)
        .map((k) => `${k} := ${lit(args[k], sig[k])}`)
        .join(", ");
      const sql = `SELECT coalesce(json_agg(r), '[]'::json) FROM (SELECT * FROM public.${fn}(${params})) r`;
      try {
        const rows = JSON.parse(psql(sql) || "[]") as any[];
        const data = rows.map((r) => {
          const keys = Object.keys(r ?? {});
          return keys.length === 1 ? r[keys[0]] : r;
        });
        return Promise.resolve({ data, error: null });
      } catch (e: any) {
        const message = String(e?.stderr ?? e?.message ?? e).slice(0, 400);
        return Promise.resolve({ data: null, error: { message } });
      }
    },
    from(table: string) {
      return {
        insert(row: any) {
          try {
            if (psql(`SELECT v::text FROM public.p05_switches WHERE k='log_fail'`) === "true") {
              throw new Error("log down (simulado)");
            }
            psqlWorker(`INSERT INTO public.${table}(entity, status, error_message, metadatos) VALUES (${lit(row.entity, "text")}, ${lit(row.status, "text")}, ${lit(row.error_message, "text")}, ${lit(row.metadatos ?? {}, "jsonb")})`);
            return Promise.resolve({ error: null });
          } catch (e: any) {
            return Promise.resolve({ error: { message: String(e?.stderr ?? e?.message) } });
          }
        },
      };
    },
  };
}

const sb = sbLive();
const uuid = () => psql("SELECT gen_random_uuid()");

function seedNota(): string {
  return psql(
    `INSERT INTO public.notas_simples(status, structured_json) VALUES ('listo', '{"needs_extract":"1"}'::jsonb) RETURNING id`,
  );
}
function seedTitular(notaId: string): string {
  return psql(
    `INSERT INTO public.nota_simple_titulares(nota_simple_id, nombre_extraido, rol) VALUES ('${notaId}', 'ANTIGUO', 'otro') RETURNING id`,
  );
}
const plan = (over: any = {}) => ({
  updates: [],
  inserts: [{ nombre_extraido: "NUEVO TITULAR", rol: "pleno" }],
  structured: { reparse_done: "1" },
  raw_pdf_text: "texto",
  attempt_count: 1,
  ...over,
});
const claimOne = async () => {
  const { data } = await sb.rpc("reparse_claim_batch", { p_limit: 1, p_lock_minutes: 10 });
  return (data as any[])[0];
};
const titulares = (notaId: string) =>
  Number(psql(`SELECT count(*) FROM public.nota_simple_titulares WHERE nota_simple_id='${notaId}'`));

d("P0.5 · claim token opaco contra PostgreSQL real", () => {
  beforeEach(() => {
    psql("DELETE FROM public.nota_simple_titulares; DELETE FROM public.notas_simples; DELETE FROM public.hubspot_sync_log; UPDATE public.p05_switches SET v=false; UPDATE public.notas_reparse_state SET match_pending=false, generation=0;");
  });

  it("el token es uuid de servidor y NINGÚN ISO/timestamp interviene", async () => {
    seedNota();
    const n = await claimOne();
    expect(n.claim_token).toMatch(/^[0-9a-f-]{36}$/);
    // La firma nueva no admite texto: la antigua (jsonb sola) ya no existe.
    expect(psql(`SELECT count(*) FROM pg_proc WHERE proname='apply_nota_reparse_plan' AND pg_get_function_identity_arguments(oid)='jsonb'`)).toBe("0");
    expect(psql(`SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='apply_nota_reparse_plan'`)).toBe("p_nota_id uuid, p_claim_token uuid, p_payload jsonb");
    // Un ISO de JS como token es sencillamente inválido.
    const bad = await sb.rpc("apply_nota_reparse_plan", { p_nota_id: n.id, p_claim_token: new Date().toISOString(), p_payload: plan() });
    expect(bad.error).toBeTruthy();
  });

  it("claim correcto: aplica titulares y finaliza en la misma transacción", async () => {
    const id = seedNota();
    const t = seedTitular(id);
    const n = await claimOne();
    const r = await sb.rpc("apply_nota_reparse_plan", {
      p_nota_id: n.id,
      p_claim_token: n.claim_token,
      p_payload: plan({ updates: [{ id: t, patch: { rol: "pleno" } }] }),
    });
    expect(r.error).toBeNull();
    expect((r.data as any[])[0]).toMatchObject({ ok: true, updated: 1, inserted: 1, finalized: true });
    expect(titulares(id)).toBe(2);
    expect(psql(`SELECT claim_token IS NULL AND claim_expires_at IS NULL FROM public.notas_simples WHERE id='${id}'`)).toBe("t");
  });

  it("claim perdido (token ajeno) => cero cambios en hijos", async () => {
    const id = seedNota();
    await claimOne();
    const r = await sb.rpc("apply_nota_reparse_plan", { p_nota_id: id, p_claim_token: await uuid(), p_payload: plan() });
    expect(String(r.error?.message)).toContain("claim_lost");
    expect(titulares(id)).toBe(0);
  });

  it("claim EXPIRADO falla y no escribe", async () => {
    const id = seedNota();
    const n = await claimOne();
    psql(`UPDATE public.notas_simples SET claim_expires_at = now() - interval '1 minute' WHERE id='${id}'`);
    const r = await sb.rpc("apply_nota_reparse_plan", { p_nota_id: id, p_claim_token: n.claim_token, p_payload: plan() });
    expect(String(r.error?.message)).toContain("claim_lost");
    expect(titulares(id)).toBe(0);
  });

  it("un update que no pertenece a la nota fuerza ROLLBACK total", async () => {
    const idA = seedNota();
    const idB = seedNota();
    const ajeno = seedTitular(idB);
    const n = (await sb.rpc("reparse_claim_batch", { p_limit: 2, p_lock_minutes: 10 })).data!.find((x: any) => x.id === idA);
    const r = await sb.rpc("apply_nota_reparse_plan", {
      p_nota_id: idA, p_claim_token: n.claim_token,
      p_payload: plan({ updates: [{ id: ajeno, patch: { rol: "pleno" } }] }),
    });
    expect(String(r.error?.message)).toContain("titular_update_fail");
    expect(titulares(idA)).toBe(0); // el insert del mismo plan también se revirtió
    expect(psql(`SELECT rol FROM public.nota_simple_titulares WHERE id='${ajeno}'`)).toBe("otro");
    expect(psql(`SELECT claim_token IS NOT NULL FROM public.notas_simples WHERE id='${idA}'`)).toBe("t");
  });

  it("dos workers concurrentes: sólo uno finaliza", async () => {
    const id = seedNota();
    const n = await claimOne();
    const segundo = await claimOne(); // el lote está tomado: nadie más lo coge
    expect(segundo).toBeUndefined();
    const ok = await sb.rpc("apply_nota_reparse_plan", { p_nota_id: id, p_claim_token: n.claim_token, p_payload: plan() });
    expect(ok.error).toBeNull();
    const repetido = await sb.rpc("apply_nota_reparse_plan", { p_nota_id: id, p_claim_token: n.claim_token, p_payload: plan() });
    expect(String(repetido.error?.message)).toContain("claim_lost");
    expect(titulares(id)).toBe(1);
  });

  it("liberación CAS: el token correcto libera; el viejo NO pisa al nuevo", async () => {
    const id = seedNota();
    const viejo = await claimOne();
    psql(`UPDATE public.notas_simples SET claim_expires_at = now() - interval '1 minute' WHERE id='${id}'`);
    const nuevo = await claimOne();
    expect(nuevo.claim_token).not.toBe(viejo.claim_token);

    const stale = await sb.rpc("release_nota_reparse_claim", { p_id: id, p_expected_token: viejo.claim_token });
    expect((stale.data as any[])[0] ?? null).toBeNull();
    expect(psql(`SELECT claim_token='${nuevo.claim_token}' FROM public.notas_simples WHERE id='${id}'`)).toBe("t");

    const mio = await sb.rpc("release_nota_reparse_claim", { p_id: id, p_expected_token: nuevo.claim_token });
    expect((mio.data as any[])[0]).toBe(id);
    expect(psql(`SELECT claim_token IS NULL FROM public.notas_simples WHERE id='${id}'`)).toBe("t");
  });

  it("fallo de mark ANTES de procesar libera cada claim por CAS y devuelve 500/partial", async () => {
    const id = seedNota();
    const deps = createReparseDeps(sb as any, {
      claimMinutes: 10,
      processNota: async (n: any) => ({ id: n.id, ok: true }),
    });
    const roto = { ...deps, markPending: async () => ({ ok: false as const, error: "mark boom" }) };
    const r = await runReparseCycle(roto, { limit: 5 });
    expect([r.http, r.body.status, r.body.match_pending]).toEqual([500, "partial", true]);
    expect(psql(`SELECT claim_token IS NULL FROM public.notas_simples WHERE id='${id}'`)).toBe("t");
    expect(titulares(id)).toBe(0);
  });

  it("integrado handler→claim→apply→matching→CAS clear (camino feliz)", async () => {
    const id = seedNota();
    const deps = createReparseDeps(sb as any, {
      claimMinutes: 10,
      processNota: async (n: any) => {
        const r = await sb.rpc("apply_nota_reparse_plan", { p_nota_id: n.id, p_claim_token: n.claim_token, p_payload: plan() });
        return r.error ? { id: n.id, ok: false, reason: r.error.message } : { id: n.id, ok: true };
      },
    });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect([r.http, r.body.status, r.body.match_pending]).toEqual([200, "ok", false]);
    expect(titulares(id)).toBe(1);
    expect(psql("SELECT match_pending FROM public.notas_reparse_state")).toBe("f");
  });

  it("notas OK + matching caído => 500/partial y pendiente conservado", async () => {
    const id = seedNota();
    await sb.rpc("p05_set_switch", { p_k: "match_fail", p_v: true });
    const deps = createReparseDeps(sb as any, {
      claimMinutes: 10,
      processNota: async (n: any) => {
        await sb.rpc("apply_nota_reparse_plan", { p_nota_id: n.id, p_claim_token: n.claim_token, p_payload: plan() });
        return { id: n.id, ok: true };
      },
    });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect([r.http, r.body.status, r.body.match_pending]).toEqual([500, "partial", true]);
    expect(titulares(id)).toBe(1); // las notas finalizadas se conservan
    expect(psql("SELECT match_pending FROM public.notas_reparse_state")).toBe("t");
  });

  it("excepción del log => 500 contractual y el singleton manda", async () => {
    seedNota();
    await sb.rpc("p05_set_switch", { p_k: "log_fail", p_v: true });
    const deps = createReparseDeps(sb as any, { claimMinutes: 10, processNota: async (n: any) => ({ id: n.id, ok: true }) });
    const r = await runReparseCycle(deps, { limit: 5 });
    expect([r.http, r.body.status]).toEqual([500, "partial"]);
    expect(String(r.body.error_message)).toContain("log_insert_fail");
    expect(psql("SELECT match_pending FROM public.notas_reparse_state")).toBe("f");
  });

  it("permisos: la tabla de estado no es accesible directamente por nadie", () => {
    for (const rol of ["service_role", "authenticated", "anon"]) {
      for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(psql(`SELECT has_table_privilege('${rol}','public.notas_reparse_state','${priv}')`)).toBe("f");
      }
    }
    expect(psql(`SELECT has_function_privilege('service_role','public.apply_nota_reparse_plan(uuid,uuid,jsonb)','EXECUTE')`)).toBe("t");
    expect(psql(`SELECT has_function_privilege('anon','public.reparse_claim_batch(integer,integer)','EXECUTE')`)).toBe("f");
  });
});
