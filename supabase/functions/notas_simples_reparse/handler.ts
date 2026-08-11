/**
 * HANDLER REAL del reparseo, sin dependencias exclusivas de Deno.
 *
 * Contiene la ÚNICA implementación de:
 *   - processNotaWithClaim: pipeline de una nota YA reclamada + cierre de
 *     intento fallido por RPC CAS (reparse_fail_nota) con el token del
 *     servidor. El pipeline concreto (descarga de PDF + LLM) se inyecta.
 *   - handleReparseRequest: el handler que sirve Deno.serve en index.ts.
 *
 * Los tests de integración llaman a ESTAS funciones, no a una copia.
 */
import { runReparseCycle } from "./orchestrator.ts";
import { createReparseDeps } from "./deps.ts";
import { decidirAuth, redactar, type JwtVerifier } from "./auth.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const DEFAULT_LIMIT = 2;
export const MAX_LIMIT = 5;
export const CLAIM_MINUTES = 30;
export const MAX_ATTEMPTS = 5;
/** Tope duro de bytes de cuerpo aceptados (canario dirigido, no ingesta masiva). */
export const MAX_BODY_BYTES = 8 * 1024;
/** Tope duro de ids aceptados en un canario dirigido. */
export const MAX_IDS = MAX_LIMIT;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canario dirigido FAIL-CLOSED (P0.8): si el cuerpo trae `ids` no vacío,
 * CUALQUIER entrada inválida (no UUID, duplicada o por encima del tope)
 * invalida la petición entera. Jamás se degrada al lote general de la cola.
 */
export type IdsParse =
  | { ok: true; ids: string[] }
  | { ok: false; reason: string; detalle: string };

export function parseIdsStrict(raw: unknown): IdsParse {
  if (raw == null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "ids_invalidos", detalle: "ids debe ser un array" };
  if (raw.length === 0) return { ok: true, ids: [] };
  if (raw.length > MAX_IDS) {
    return { ok: false, reason: "ids_demasiados", detalle: `${raw.length} > ${MAX_IDS}` };
  }
  const out: string[] = [];
  for (const v of raw) {
    const s = String(v ?? "").trim();
    if (!UUID_RE.test(s)) return { ok: false, reason: "id_invalido", detalle: s.slice(0, 60) };
    if (out.includes(s)) return { ok: false, reason: "id_duplicado", detalle: s };
    out.push(s);
  }
  return { ok: true, ids: out };
}

/** Compatibilidad: lista de ids válidos, vacía si el cuerpo no es válido. */
export function parseIds(raw: unknown): string[] {
  const r = parseIdsStrict(raw);
  return r.ok ? r.ids : [];
}

export function backoffMinutes(attempt: number): number {
  return Math.min(360, 15 * Math.pow(2, Math.max(0, attempt - 1)));
}

/** Resultado del pipeline de UNA nota (descarga + extracción + apply RPC). */
export type ProcessOne = (
  sb: any,
  nota: any,
  claimToken: string,
) => Promise<{ id: string; ok: boolean; reason?: string; [k: string]: unknown }>;

/**
 * Pipeline + estado de reintento de UNA nota YA reclamada.
 * El claim_token lo emitió el servidor en reparse_claim_batch: aquí no se
 * genera ni se renueva ningún token, y el cierre de intento fallido pasa por
 * la RPC CAS reparse_fail_nota (nunca por un UPDATE directo). Si el lease ya
 * no está vigente, la RPC devuelve false y el fallo se reporta.
 */
export async function processNotaWithClaim(sb: any, n: any, processOne: ProcessOne) {
  const claimToken: string | null = n?.claim_token ?? null;
  if (!claimToken) {
    return { id: n?.id as string, ok: false, reason: "claim_token_ausente" };
  }

  const r: any = await processOne(sb, n, claimToken);
  if (!r.ok) {
    const attempts = (n.attempt_count ?? 0) + 1;
    // Un fallo FATAL (binario irrecuperable tras la reingesta única) no vuelve
    // a la cola: dead-letter inmediato, sin bucle.
    const dead = r.fatal === true || attempts >= MAX_ATTEMPTS;
    const { data, error } = await sb.rpc("reparse_fail_nota", {
      p_id: n.id,
      p_expected_token: claimToken,
      p_last_error: String(r.reason ?? "desconocido").slice(0, 500),
      p_attempt: attempts,
      p_next_retry_at: dead ? null : new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString(),
      p_dead: dead,
    });
    const applied = (Array.isArray(data) ? data[0] : data) === true;
    if (error || !applied) {
      r.retry_state_fail = error?.message ?? "rows=0";
      r.reason = `${r.reason} | retry_state_fail:${r.retry_state_fail}`.slice(0, 400);
    }
    r.attempt_count = attempts;
    r.dead_letter = dead;
  }
  return r;
}

/**
 * Handler HTTP real: request -> claim_batch -> processNotaWithClaim ->
 * apply/fail -> matching -> clear CAS -> log -> Response.
 */
export async function handleReparseRequest(
  req: Request,
  sb: any,
  processOne: ProcessOne,
  authOpts?: {
    internalSecret?: string | null;
    serviceRoleKey?: string | null;
    verifyJwt?: JwtVerifier | null;
  },
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (payload: Record<string, unknown>, status: number) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // 1) AUTORIZACIÓN EN CÓDIGO. verify_jwt=false no abre el endpoint.
  const auth = await decidirAuth({
    headers: req.headers,
    internalSecret: authOpts?.internalSecret ?? null,
    serviceRoleKey: authOpts?.serviceRoleKey ?? null,
    verifyJwt: authOpts?.verifyJwt ?? null,
  });
  if (auth.ok === false) {
    return json({ ok: false, status: "unauthorized", error_message: redactar(auth.reason) }, auth.status);
  }

  // 2) Cuerpo acotado en bytes y validado fail-closed.
  let raw = "";
  try { raw = await req.text(); } catch { raw = ""; }
  if (raw.length > MAX_BODY_BYTES) {
    return json({ ok: false, status: "rejected", error_message: `body_demasiado_grande:${raw.length}` }, 413);
  }
  let body: any = {};
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { return json({ ok: false, status: "rejected", error_message: "body_json_invalido" }, 400); }
  }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body?.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const parsed = parseIdsStrict(body?.ids);
  if (parsed.ok === false) {
    // Nunca se cae al lote general: la petición dirigida falla cerrada.
    return json({ ok: false, status: "rejected", error_message: `${parsed.reason}:${redactar(parsed.detalle)}` }, 400);
  }
  const ids = parsed.ids;

  const deps = createReparseDeps(sb, {
    claimMinutes: Math.max(1, Math.min(120, Number(body?.lock_minutes ?? CLAIM_MINUTES) || CLAIM_MINUTES)),
    ids,
    processNota: (n: any) => processNotaWithClaim(sb, n, processOne),
  });

  const cycle = await runReparseCycle(deps, { limit });
  // Conjunto exacto no reclamable (id inexistente o en manos de otro worker):
  // 409, sin haber procesado ni escrito nada.
  if (ids.length && /ids_no_reclamables_exactos/.test(String((cycle.body as any)?.error_message ?? ""))) {
    return json({ ...cycle.body, ok: false, status: "rejected" }, 409);
  }
  // Los ids solicitados deben reclamarse TODOS: si alguno no es reclamable,
  // la respuesta es un fallo explícito, jamás un lote parcial silencioso.
  const body2: Record<string, unknown> = { ...cycle.body };
  if (ids.length) {
    const procesadas = Array.isArray((cycle.body as any).resultados) ? (cycle.body as any).resultados.length : 0;
    if (procesadas !== ids.length) {
      body2.ok = false;
      body2.status = "partial";
      body2.error_message = [`ids_no_reclamables:${ids.length - procesadas}`, body2.error_message]
        .filter(Boolean).join(" | ");
      return json(body2, 500);
    }
  }
  return json(body2, cycle.http);
}
