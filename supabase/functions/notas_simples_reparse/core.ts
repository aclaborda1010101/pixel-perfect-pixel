// Núcleo productivo del reparseo: refetch -> validación -> plan -> persistencia -> finalize,
// y decisión de matching. Puro / repository-driven: sin Deno, sin red, sin Supabase.
// index.ts USA este módulo (no hay hooks exclusivos de test).

import {
  hasRealEvidence,
  normalizeTitularesChecked,
  type TitularNormalizado,
} from "./lib.ts";
import {
  needsTitularesRefetch,
  runReconciliation,
  type FilaExistente,
  type OpResult,
  type ReconcileRepo,
} from "./reconcile.ts";

export type ExtraccionLLM = {
  data: ({ titulares?: unknown[] } & Record<string, unknown>) | null;
  error?: string;
  model?: string;
};

export type NotaRepo = Omit<ReconcileRepo, "finalizeNota"> & {
  /** SELECT de los titulares actuales de la nota. */
  listTitulares(notaId: string): Promise<{ rows: FilaExistente[]; error?: string | null }>;
  /** UPDATE ... WHERE id AND claimed_at=claimToken RETURNING id (exactamente 1). */
  finalizeNota(args: {
    id: string;
    claimToken: string;
    titulares: TitularNormalizado[];
    extracted: Record<string, unknown>;
    model: string | null;
  }): Promise<OpResult>;
};

export type ResultadoCore = {
  ok: boolean;
  reason?: string;
  detalle?: string;
  updated: number;
  inserted: number;
  finalized: boolean;
  model?: string | null;
  refetched: boolean;
  titulares?: TitularNormalizado[];
};

/**
 * Validación estricta de titulares RECIÉN extraídos: nombre (ya garantizado),
 * rol_literal explícito y evidencia real con localizador. El porcentaje ya se
 * valida en la normalización (no vacío inválido => fallo).
 */
export function validarTitularesNuevos(
  titulares: TitularNormalizado[],
): { ok: true } | { ok: false; reason: string; detalle: string } {
  for (const t of titulares) {
    if (!t.rol_literal || !String(t.rol_literal).trim()) {
      return { ok: false, reason: "titular_sin_rol_literal", detalle: t.nombre };
    }
    if (!hasRealEvidence(t.evidencia)) {
      return { ok: false, reason: "titular_sin_evidencia_real", detalle: t.nombre };
    }
  }
  return { ok: true };
}

/**
 * Decide la lista de titulares a conciliar.
 * - Si hace falta refetch: EXIGE titulares nuevos del LLM (prohibido el fallback
 *   a los actuales) y validación estricta.
 * - Si no hace falta: reconcilia los actuales; lista vacía => nunca finaliza.
 */
export function decidirTitulares(args: {
  needsRefetch: boolean;
  extraidos: unknown;
  actuales: unknown;
}): { ok: true; value: TitularNormalizado[]; refetched: boolean } | { ok: false; reason: string; detalle?: string } {
  const nuevos = Array.isArray(args.extraidos) ? args.extraidos : [];
  if (args.needsRefetch) {
    if (nuevos.length === 0) {
      return { ok: false, reason: "titulares_refetch_vacio", detalle: "el LLM no devolvió titulares" };
    }
    const norm = normalizeTitularesChecked(nuevos);
    if (norm.ok === false) return { ok: false, reason: norm.reason, detalle: norm.detalle };
    const estricto = validarTitularesNuevos(norm.value);
    if (estricto.ok === false) return { ok: false, reason: estricto.reason, detalle: estricto.detalle };
    return { ok: true, value: norm.value, refetched: true };
  }
  const fuente = nuevos.length ? nuevos : (Array.isArray(args.actuales) ? args.actuales : []);
  if (fuente.length === 0) return { ok: false, reason: "titulares_source_empty" };
  const norm = normalizeTitularesChecked(fuente);
  if (norm.ok === false) return { ok: false, reason: norm.reason, detalle: norm.detalle };
  if (nuevos.length) {
    const estricto = validarTitularesNuevos(norm.value);
    if (estricto.ok === false) return { ok: false, reason: estricto.reason, detalle: estricto.detalle };
  }
  return { ok: true, value: norm.value, refetched: nuevos.length > 0 };
}

/** Pipeline completo de una nota, contra un repositorio inyectado. */
export async function processNotaCore(
  deps: { repo: NotaRepo; extract: (needTitulares: boolean) => Promise<ExtraccionLLM> },
  args: { notaId: string; claimToken: string; structured: unknown },
): Promise<ResultadoCore> {
  const needsRefetch = needsTitularesRefetch(args.structured);
  const base: ResultadoCore = { ok: false, updated: 0, inserted: 0, finalized: false, refetched: false };

  const llm = await deps.extract(needsRefetch);
  if (!llm.data) {
    return { ...base, reason: "llm_fail", detalle: (llm.error ?? "sin detalle").slice(0, 300) };
  }

  const actuales = (args.structured as any)?.titulares;
  const decision = decidirTitulares({ needsRefetch, extraidos: llm.data.titulares, actuales });
  if (decision.ok === false) {
    return { ...base, reason: decision.reason, detalle: decision.detalle, model: llm.model ?? null };
  }
  const titulares = decision.value;

  const existentes = await deps.repo.listTitulares(args.notaId);
  if (existentes.error) {
    return { ...base, reason: "titulares_read_fail", detalle: String(existentes.error).slice(0, 300) };
  }

  const wrapped: ReconcileRepo = {
    updateTitular: (id, patch) => deps.repo.updateTitular(id, patch),
    insertTitular: (row) => deps.repo.insertTitular(row),
    ...(deps.repo.backfill ? { backfill: () => deps.repo.backfill!() } : {}),
    finalizeNota: ({ id, claimToken }) =>
      deps.repo.finalizeNota({
        id,
        claimToken,
        titulares,
        extracted: llm.data as Record<string, unknown>,
        model: llm.model ?? null,
      }),
  };

  const res = await runReconciliation(wrapped, {
    notaId: args.notaId,
    claimToken: args.claimToken,
    existentes: existentes.rows ?? [],
    deseados: titulares,
  });

  return {
    ok: res.ok,
    reason: res.reason,
    detalle: res.detalle,
    updated: res.updated,
    inserted: res.inserted,
    finalized: res.finalized,
    model: llm.model ?? null,
    refetched: decision.refetched,
    titulares,
  };
}

// ---------- decisión de matching ----------

export type MatchOutcome =
  | { status: "skipped"; reason: string; pending: boolean; data?: null; error?: null }
  | { status: "ok"; reason: string; pending: false; data: unknown; error: null }
  | { status: "error"; reason: string; pending: true; data: null; error: string };

/**
 * El matching se ejecuta si AL MENOS una nota finalizó bien, aunque otras fallen.
 * Un éxito parcial nunca deja de disparar el emparejado.
 */
export function decideMatching(args: { ok: number; failed: number }): { run: boolean; reason: string } {
  if (args.ok > 0) return { run: true, reason: args.failed > 0 ? "parcial_con_exitos" : "lote_ok" };
  return { run: false, reason: "sin_exitos" };
}

/**
 * En un lote drenado (0 notas) sólo se intenta el matching si quedó pendiente
 * de una ejecución anterior (marcador durable en el log). Evita el bucle caro.
 */
export function decidePendingMatchOnDrain(
  ultimoLog: { metadatos?: { match_pending?: unknown } | null } | null | undefined,
): { run: boolean; reason: string } {
  const pending = ultimoLog?.metadatos?.match_pending === true;
  return pending ? { run: true, reason: "match_pendiente_previo" } : { run: false, reason: "nada_pendiente" };
}

// ---------- estado DURABLE de match_pending ----------

export type LogRow = { metadatos?: { match_pending?: unknown } | null } | null | undefined;

/** Estado durable leído del historial. `known:false` => no se puede garantizar. */
export type MatchPendingState =
  | { known: true; pending: boolean; source: "log" | "sin_historial" }
  | { known: false; pending: true; reason: string };

/**
 * Pliega un historial ACOTADO (más reciente primero) hasta encontrar el último
 * registro que contenga realmente un boolean `match_pending`.
 * - error de lectura => desconocido (conservador: pending=true).
 * - historial agotado sin encontrar el campo => desconocido si venía truncado.
 * - sin historial en absoluto => known, pending=false.
 */
export function foldMatchPendingHistory(args: {
  rows?: LogRow[] | null;
  error?: unknown;
  limit?: number;
}): MatchPendingState {
  if (args.error) {
    return { known: false, pending: true, reason: `state_read_error:${String((args.error as any)?.message ?? args.error).slice(0, 200)}` };
  }
  const rows = Array.isArray(args.rows) ? args.rows : null;
  if (rows == null) return { known: false, pending: true, reason: "state_read_error:sin_filas" };
  for (const r of rows) {
    const v = r?.metadatos?.match_pending;
    if (typeof v === "boolean") return { known: true, pending: v, source: "log" };
  }
  const limit = args.limit ?? rows.length;
  if (rows.length > 0 && rows.length >= limit) {
    return { known: false, pending: true, reason: "state_read_error:historial_agotado" };
  }
  return { known: true, pending: false, source: "sin_historial" };
}

export type NextMatchPending = {
  pending: boolean;
  /** El estado anterior no era legible y no se pudo resolver en este ciclo. */
  degraded: boolean;
  stateReadError: string | null;
  reason: "rpc_ok" | "rpc_fail" | "conservado" | "conservado_sin_estado";
};

/**
 * Estado siguiente de match_pending. NUNCA borra un pendiente anterior si en
 * este ciclo no hubo una RPC de matching con éxito.
 */
export function computeNextMatchPending(args: {
  previous: MatchPendingState;
  ran: boolean;
  outcome?: MatchOutcome | null;
}): NextMatchPending {
  const readError = args.previous.known ? null : args.previous.reason;
  if (args.ran && args.outcome) {
    if (args.outcome.status === "ok") {
      return { pending: false, degraded: false, stateReadError: readError, reason: "rpc_ok" };
    }
    return { pending: true, degraded: false, stateReadError: readError, reason: "rpc_fail" };
  }
  if (args.previous.known) {
    return { pending: args.previous.pending, degraded: false, stateReadError: null, reason: "conservado" };
  }
  return { pending: true, degraded: true, stateReadError: readError, reason: "conservado_sin_estado" };
}

/**
 * Drenado: se intenta un ÚNICO RPC acotado si quedó pendiente o si el estado no
 * es legible (conservador: resolverlo es más seguro que perderlo).
 */
export function decidePendingMatchOnDrainState(state: MatchPendingState): { run: boolean; reason: string } {
  if (!state.known) return { run: true, reason: "estado_no_legible" };
  return state.pending
    ? { run: true, reason: "match_pendiente_previo" }
    : { run: false, reason: "nada_pendiente" };
}

/** Semántica explícita del fallo del RPC de matching (no invalida los éxitos). */
export async function runMatching(
  rpc: () => Promise<{ data?: unknown; error?: { message?: string } | string | null }>,
): Promise<MatchOutcome> {
  try {
    const r = await rpc();
    const err = typeof r?.error === "string" ? r.error : r?.error?.message ?? null;
    if (err) return { status: "error", reason: "rpc_error", pending: true, data: null, error: String(err).slice(0, 300) };
    return { status: "ok", reason: "rpc_ok", pending: false, data: r?.data ?? null, error: null };
  } catch (e) {
    return {
      status: "error",
      reason: "rpc_exception",
      pending: true,
      data: null,
      error: String((e as Error)?.message ?? e).slice(0, 300),
    };
  }
}