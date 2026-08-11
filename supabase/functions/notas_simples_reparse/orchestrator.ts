// Orquestación productiva del ciclo de reparseo. Puro / inyectable:
// index.ts usa ESTE core (no hay una segunda copia de la lógica).
//
// Contrato:
//   leer estado atómico -> reclamar lote -> mark_pending (si hay lote)
//   -> procesar notas -> matching -> clear_pending(CAS) -> log -> HTTP.
//
// Reglas duras:
//  - El estado singleton (generation/pending) es la ÚNICA fuente de verdad.
//    El log de auditoría NUNCA decide nada.
//  - Sólo un matching con éxito puede limpiar, y sólo por CAS sobre la
//    generación que este ciclo marcó.
//  - Cualquier fallo de estado (leer/marcar/limpiar), de matching o del
//    INSERT del log => HTTP 500 y status "partial".

import { decideMatching, type MatchOutcome } from "./core.ts";
import { summarizeBatch } from "./reconcile.ts";

export type StateRead =
  | { ok: true; pending: boolean; generation: number }
  | { ok: false; error: string };
export type MarkResult = { ok: true; generation: number } | { ok: false; error: string };
export type ClearResult = { ok: true; cleared: boolean } | { ok: false; error: string };

export type NotaResult = { id: string; ok: boolean; reason?: string; [k: string]: unknown };

export type CycleDeps = {
  readState(): Promise<StateRead>;
  markPending(): Promise<MarkResult>;
  clearPending(expectedGeneration: number): Promise<ClearResult>;
  claimBatch(limit: number): Promise<{ rows: unknown[] | null; error?: string | null }>;
  /** Procesa UNA nota (claim refresh + pipeline + retry state) y devuelve su resultado. */
  processNota(nota: any): Promise<NotaResult>;
  /**
   * Libera el claim de UNA nota por CAS (id + token del servidor).
   * released=false significa que el claim ya no era nuestro: JAMÁS se pisa
   * el claim de otro worker. Cualquier error se reporta, nunca se traga.
   */
  releaseClaim?(nota: unknown): Promise<{ ok: boolean; released: boolean; error?: string | null }>;
  runMatch(): Promise<MatchOutcome>;
  insertLog(entry: Record<string, unknown>): Promise<{ error?: string | null }>;
  now?(): number;
};

export type CycleResult = {
  http: number;
  body: Record<string, unknown>;
  logged: Record<string, unknown> | null;
  logError: string | null;
};

function fail(
  deps: CycleDeps,
  t0: number,
  reason: string,
  detail: string,
  extra: Record<string, unknown> = {},
): Promise<CycleResult> {
  const metadatos = { failure: reason, error_detail: detail, ...extra };
  return (async () => {
    let logError: string | null = null;
    try {
      const r = await deps.insertLog({
        entity: "notas_simples_reparse",
        started_at: new Date(t0).toISOString(),
        finished_at: new Date((deps.now?.() ?? Date.now())).toISOString(),
        records_upserted: 0,
        records_failed: 0,
        status: "partial",
        error_message: `${reason}:${detail}`.slice(0, 1000),
        metadatos,
      });
      logError = r?.error ? String(r.error) : null;
    } catch (e) {
      logError = String((e as Error)?.message ?? e);
    }
    return {
      http: 500,
      body: {
        ok: false,
        status: "partial",
        procesadas: 0,
        error_message: `${reason}:${detail}`.slice(0, 1000),
        ...extra,
        log_error: logError,
      },
      logged: metadatos,
      logError,
    };
  })();
}

/**
 * Envoltura de honestidad: TODA la orquestación real (readState, claimBatch,
 * markPending, processNota, matching, clearPending, release y log) queda
 * dentro. Cualquier excepción inesperada se normaliza a HTTP 500 con
 * ok:false / status:"partial" y un error_message trazable; el pendiente del
 * singleton se conserva porque nunca se limpia sin CAS con éxito.
 */
export async function runReparseCycle(deps: CycleDeps, opts: { limit: number }): Promise<CycleResult> {
  const t0 = deps.now?.() ?? Date.now();
  try {
    return await runReparseCycleInner(deps, opts);
  } catch (e) {
    const detalle = String((e as Error)?.stack ?? (e as Error)?.message ?? e).slice(0, 600);
    try {
      return await fail(deps, t0, "cycle_exception", detalle, { match_pending: true });
    } catch (e2) {
      // Ni siquiera el log de fallo funcionó: el singleton es la fuente de verdad.
      const logError = String((e2 as Error)?.message ?? e2).slice(0, 300);
      return {
        http: 500,
        body: {
          ok: false,
          status: "partial",
          procesadas: 0,
          match_pending: true,
          error_message: `cycle_exception:${detalle}`.slice(0, 1000),
          log_error: logError,
        },
        logged: null,
        logError,
      };
    }
  }
}

async function runReparseCycleInner(deps: CycleDeps, opts: { limit: number }): Promise<CycleResult> {
  const now = () => deps.now?.() ?? Date.now();
  const t0 = now();

  // 1) Estado atómico (nunca del log). Error de lectura => 500, cero notas.
  const state = await deps.readState();
  if (state.ok === false) {
    return await fail(deps, t0, "state_read_fail", state.error, { match_pending: true });
  }

  // 2) Lote
  const batch = await deps.claimBatch(opts.limit);
  if (batch.error) {
    return await fail(deps, t0, "claim_batch_fail", String(batch.error), { match_pending: state.pending });
  }
  const notas = Array.isArray(batch.rows) ? batch.rows : [];

  // 3) Lote vacío: drenado. true => un intento acotado; false => no-op.
  if (notas.length === 0) {
    return await drain(deps, t0, state);
  }

  // 4) Marcar pendiente ANTES de tocar ninguna nota.
  const mark = await deps.markPending();
  if (mark.ok === false) {
    // Liberación CAS: exactamente una fila por nota. 0 filas o error se
    // reportan; nunca se pisa el claim de otro worker.
    const releaseErrors: string[] = [];
    if (deps.releaseClaim) {
      for (const n of notas) {
        try {
          const r = await deps.releaseClaim(n);
          if (!r.ok) releaseErrors.push(`release_error:${String(r.error ?? "desconocido").slice(0, 120)}`);
          else if (!r.released) releaseErrors.push("release_cas_miss");
        } catch (e) {
          releaseErrors.push(`release_exception:${String((e as Error)?.message ?? e).slice(0, 120)}`);
        }
      }
    }
    return await fail(deps, t0, "state_mark_fail", mark.error, {
      match_pending: true,
      notas_en_lote: notas.length,
      release_errors: releaseErrors,
      released: notas.length - releaseErrors.length,
    });
  }
  const token = mark.generation;

  // 5) Procesar
  const results: NotaResult[] = [];
  const errores: string[] = [];
  for (const n of notas) {
    const r = await deps.processNota(n);
    results.push(r);
    if (!r.ok) errores.push(`${r.id}:${String(r.reason ?? "desconocido").slice(0, 160)}`);
  }
  const ok = results.filter((r) => r.ok).length;
  const resumen = summarizeBatch(results.length, ok, errores);

  // 6) Matching + limpieza CAS
  const matchDecision = decideMatching({ ok, failed: resumen.records_failed });
  let outcome: MatchOutcome | null = null;
  let cleared = false;
  let casConflict = false;
  let clearError: string | null = null;

  if (matchDecision.run) {
    outcome = await deps.runMatch();
    if (outcome.status === "ok") {
      const clr = await deps.clearPending(token);
      if (clr.ok === false) clearError = clr.error;
      else {
        cleared = clr.cleared;
        casConflict = !clr.cleared;
      }
    }
  }
  // Sin matching o con matching fallido NUNCA se escribe false.
  const matchPending = !cleared;

  const matchError = outcome?.status === "error" ? outcome.error : null;
  const degradado = !!matchError || !!clearError;
  const httpBase = degradado && resumen.http < 400 ? 500 : resumen.http;
  const statusBase = degradado && resumen.status === "ok" ? "partial" : resumen.status;
  const errorMessage = [resumen.error_message, matchError ? `match_error:${matchError}` : null,
    clearError ? `state_clear_fail:${clearError}` : null].filter(Boolean).join(" | ") || null;

  const metadatos = {
    ok,
    fail: resumen.records_failed,
    generation: token,
    match_status: outcome?.status ?? "skipped",
    match_error: matchError,
    match_reason: matchDecision.reason,
    match_pending: matchPending,
    match_cleared: cleared,
    cas_conflict: casConflict,
    state_clear_error: clearError,
    match_result: outcome?.status === "ok" ? outcome.data : null,
    fallidas: results.filter((r) => !r.ok).slice(0, 20).map((r) => ({ id: r.id, reason: r.reason })),
  };

  // 7) Log auditor: si falla, el estado singleton sigue intacto pero HTTP 500.
  let logError: string | null = null;
  try {
    const r = await deps.insertLog({
      entity: "notas_simples_reparse",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date(now()).toISOString(),
      records_upserted: resumen.records_upserted,
      records_failed: resumen.records_failed,
      status: statusBase,
      error_message: errorMessage,
      metadatos,
    });
    logError = r?.error ? String(r.error) : null;
  } catch (e) {
    logError = String((e as Error)?.message ?? e);
  }

  const http = logError ? 500 : httpBase;
  const status = logError ? "partial" : statusBase;

  return {
    http,
    body: {
      ok: http < 400 && resumen.ok && !degradado,
      status,
      procesadas: results.length,
      correctas: resumen.records_upserted,
      fallidas: resumen.records_failed,
      error_message: [errorMessage, logError ? `log_insert_fail:${logError}` : null].filter(Boolean).join(" | ") || null,
      match_status: outcome?.status ?? "skipped",
      match_result: outcome?.status === "ok" ? outcome.data : null,
      match_pending: matchPending,
      generation: token,
      cas_conflict: casConflict,
      log_error: logError,
      elapsed_ms: now() - t0,
      resultados: results,
    },
    logged: metadatos,
    logError,
  };
}

async function drain(deps: CycleDeps, t0: number, state: { pending: boolean; generation: number }): Promise<CycleResult> {
  const now = () => deps.now?.() ?? Date.now();
  let outcome: MatchOutcome | null = null;
  let cleared = false;
  let casConflict = false;
  let clearError: string | null = null;

  if (state.pending) {
    outcome = await deps.runMatch();
    if (outcome.status === "ok") {
      const clr = await deps.clearPending(state.generation);
      if (clr.ok === false) clearError = clr.error;
      else {
        cleared = clr.cleared;
        casConflict = !clr.cleared;
      }
    }
  }

  const matchError = outcome?.status === "error" ? outcome.error : null;
  const matchPending = state.pending ? !cleared : false;
  const degradado = !!matchError || !!clearError;
  const errorMessage = [matchError ? `match_error:${matchError}` : null,
    clearError ? `state_clear_fail:${clearError}` : null].filter(Boolean).join(" | ") || null;

  const metadatos = {
    drained: true,
    generation: state.generation,
    match_status: outcome?.status ?? "skipped",
    match_error: matchError,
    match_pending: matchPending,
    match_cleared: cleared,
    cas_conflict: casConflict,
    state_clear_error: clearError,
    match_result: outcome?.status === "ok" ? outcome.data : null,
  };

  let logError: string | null = null;
  try {
    const r = await deps.insertLog({
      entity: "notas_simples_reparse",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date(now()).toISOString(),
      records_upserted: 0,
      records_failed: 0,
      status: degradado ? "partial" : "ok",
      error_message: errorMessage,
      metadatos,
    });
    logError = r?.error ? String(r.error) : null;
  } catch (e) {
    logError = String((e as Error)?.message ?? e);
  }

  const http = degradado || logError ? 500 : 200;
  return {
    http,
    body: {
      ok: http < 400,
      status: http < 400 ? "ok" : "partial",
      procesadas: 0,
      drained: true,
      match_status: outcome?.status ?? "skipped",
      match_result: outcome?.status === "ok" ? outcome.data : null,
      match_pending: matchPending,
      generation: state.generation,
      cas_conflict: casConflict,
      log_error: logError,
      error_message: [errorMessage, logError ? `log_insert_fail:${logError}` : null].filter(Boolean).join(" | ") || null,
      elapsed_ms: now() - t0,
    },
    logged: metadatos,
    logError,
  };
}
