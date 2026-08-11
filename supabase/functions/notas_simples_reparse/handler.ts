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

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export const DEFAULT_LIMIT = 2;
export const MAX_LIMIT = 5;
export const CLAIM_MINUTES = 30;
export const MAX_ATTEMPTS = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canario dirigido: lista de ids UUID válidos (máx. MAX_LIMIT). Cualquier
 * entrada no-UUID se descarta: nunca amplía la selección de la cola.
 */
export function parseIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const s = String(v ?? "").trim();
    if (UUID_RE.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= MAX_LIMIT) break;
  }
  return out;
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
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* cuerpo opcional */ }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body?.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const ids = parseIds(body?.ids);

  const deps = createReparseDeps(sb, {
    claimMinutes: Math.max(1, Math.min(120, Number(body?.lock_minutes ?? CLAIM_MINUTES) || CLAIM_MINUTES)),
    ids,
    processNota: (n: any) => processNotaWithClaim(sb, n, processOne),
  });

  const cycle = await runReparseCycle(deps, { limit });
  return new Response(JSON.stringify(cycle.body), {
    status: cycle.http,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
