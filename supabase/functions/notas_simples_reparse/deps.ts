// Adaptador REAL de la orquestación contra la base: todas las llamadas pasan
// por RPC SECURITY DEFINER. No hay escrituras directas ni a notas_simples ni a
// notas_reparse_state (que ya no tiene GRANT alguno tras la migración P0.5).
//
// Este módulo lo usan tanto index.ts (handler) como el test de integración
// contra un PostgreSQL efímero: no existe una segunda copia del adaptador.

import { runMatching } from "./core.ts";
import type { CycleDeps, NotaResult } from "./orchestrator.ts";

/** Cliente mínimo (supabase-js o equivalente) que el adaptador necesita. */
export type SbLike = {
  rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>;
  from(table: string): {
    insert(row: unknown): Promise<{ error: { message?: string } | null }>;
  };
};

export type DepsOptions = {
  claimMinutes: number;
  /** Procesa UNA nota ya reclamada (con su claim_token de servidor). */
  processNota(nota: any): Promise<NotaResult>;
  now?(): number;
};

const msg = (e: { message?: string } | null | undefined) =>
  e ? String(e.message ?? e) : null;

const one = (data: unknown) => (Array.isArray(data) ? data[0] : data);

export function createReparseDeps(sb: SbLike, opts: DepsOptions): CycleDeps {
  return {
    async readState() {
      const { data, error } = await sb.rpc("reparse_match_state_read");
      if (error) return { ok: false, error: msg(error)! };
      const row = one(data) as any;
      if (!row) return { ok: false, error: "estado_singleton_ausente" };
      return { ok: true, pending: row.match_pending === true, generation: Number(row.generation ?? 0) };
    },

    async markPending() {
      const { data, error } = await sb.rpc("reparse_mark_match_pending");
      if (error) return { ok: false, error: msg(error)! };
      const gen = Number(one(data));
      if (!Number.isFinite(gen)) return { ok: false, error: "mark_sin_generacion" };
      return { ok: true, generation: gen };
    },

    async clearPending(expected) {
      const { data, error } = await sb.rpc("reparse_clear_match_pending", {
        p_expected_generation: expected,
      });
      if (error) return { ok: false, error: msg(error)! };
      return { ok: true, cleared: one(data) === true };
    },

    async claimBatch(limit) {
      const { data, error } = await sb.rpc("reparse_claim_batch", {
        p_limit: limit,
        p_lock_minutes: opts.claimMinutes,
      });
      if (error) return { rows: null, error: msg(error) };
      return { rows: (data ?? []) as unknown[], error: null };
    },

    /** CAS: sólo libera si el token sigue siendo el de este worker. */
    async releaseClaim(nota) {
      const n = nota as any;
      if (!n?.id || !n?.claim_token) {
        return { ok: false, released: false, error: "claim_token_ausente" };
      }
      const { data, error } = await sb.rpc("release_nota_reparse_claim", {
        p_id: n.id,
        p_expected_token: n.claim_token,
      });
      if (error) return { ok: false, released: false, error: msg(error) };
      const id = one(data);
      return { ok: true, released: !!id };
    },

    processNota: (n) => opts.processNota(n),

    runMatch: () => runMatching(async () => await sb.rpc("match_notas_pendientes")),

    async insertLog(entry) {
      const { error } = await sb.from("hubspot_sync_log").insert(entry);
      return { error: msg(error) };
    },

    now: opts.now,
  };
}
