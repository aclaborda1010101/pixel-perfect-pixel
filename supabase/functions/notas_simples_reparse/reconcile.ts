// Conciliación idempotente de derechos (titulares) de una nota simple.
// Puro: sin Deno, sin red, sin base de datos. Testeable con vitest.

import {
  baseIdentityKey,
  hasRealEvidence,
  logicalRightKey,
  mergeEvidencias,
  evidenciaStable,
  parseEvidencia,
  type Evidencia,
  type TitularNormalizado,
} from "./lib.ts";

export type FilaExistente = {
  id: string;
  nombre_extraido?: string | null;
  cif_dni?: string | null;
  porcentaje?: number | string | null;
  rol?: string | null;
  rol_literal?: string | null;
  evidencia?: unknown;
};

export type PatchTitular = {
  rol?: string;
  rol_literal?: string | null;
  evidencia?: unknown;
  /** P0.8: porcentaje EXACTO de la fuente (corrige redondeos previos). */
  porcentaje?: number;
};

export type MotivoBloqueo =
  | "titular_reconcile_ambiguous"
  | "duplicate_desired_conflicting_evidence"
  | "evidence_conflict"
  | "legacy_one_to_many_ambiguous"
  | "deseados_vacios"
  | "existing_logical_duplicate";

export type PlanConciliacion =
  | { ok: true; updates: Array<{ id: string; patch: PatchTitular }>; inserts: TitularNormalizado[] }
  | { ok: false; reason: MotivoBloqueo; detalle: string; updates: []; inserts: [] };

function esLegado(f: FilaExistente): boolean {
  return !f.rol_literal || !String(f.rol_literal).trim();
}

/** Fusión de evidencias sin pérdida (unión de fuentes). Reexporta la de lib. */
export function mergeEvidencia(a: unknown, b: unknown): { ok: true; value: Evidencia } | { ok: false } {
  const r = mergeEvidencias(a, b);
  return r.ok ? { ok: true, value: r.value } : { ok: false };
}

/**
 * Deduplica los DESEADOS entre sí antes de mirar la base: dos deseados con la misma
 * identidad lógica se fusionan si su evidencia es compatible; si no, se bloquea.
 */
export function dedupeDeseados(
  deseados: TitularNormalizado[],
): { ok: true; value: TitularNormalizado[] } | { ok: false; reason: MotivoBloqueo; detalle: string } {
  const porClave = new Map<string, TitularNormalizado>();
  const orden: string[] = [];
  for (const d of deseados) {
    const k = logicalRightKey(d);
    const prev = porClave.get(k);
    if (!prev) {
      porClave.set(k, d);
      orden.push(k);
      continue;
    }
    const merged = mergeEvidencia(prev.evidencia ?? null, d.evidencia ?? null);
    if (!merged.ok) {
      return { ok: false, reason: "duplicate_desired_conflicting_evidence", detalle: k };
    }
    porClave.set(k, { ...prev, evidencia: (merged.value ?? null) as TitularNormalizado["evidencia"] });
  }
  return { ok: true, value: orden.map((k) => porClave.get(k)!) };
}

/**
 * Devuelve el plan mínimo para que las filas existentes reflejen exactamente `deseados`.
 * - Coincidencia por identidad lógica -> UPDATE solo si cambia rol/rol_literal/evidencia.
 * - Sin coincidencia lógica -> fallback por identidad base SOLO si hay un único candidato
 *   legado (sin rol_literal). Varios candidatos -> plan bloqueado (ambiguo).
 * - En otro caso -> INSERT.
 */
export function buildReconcilePlan(
  existentes: FilaExistente[],
  deseadosRaw: TitularNormalizado[],
): PlanConciliacion {
  if (!Array.isArray(deseadosRaw) || deseadosRaw.length === 0) {
    return { ok: false, reason: "deseados_vacios", detalle: "sin titulares deseados", updates: [], inserts: [] };
  }
  const ded = dedupeDeseados(deseadosRaw ?? []);
  if (!ded.ok) {
    const f = ded as { ok: false; reason: MotivoBloqueo; detalle: string };
    return { ok: false, reason: f.reason, detalle: f.detalle, updates: [], inserts: [] };
  }
  const deseados = (ded as { ok: true; value: TitularNormalizado[] }).value;

  const updates: Array<{ id: string; patch: PatchTitular }> = [];
  const inserts: TitularNormalizado[] = [];
  const consumidas = new Set<string>();

  const porLogica = new Map<string, FilaExistente[]>();
  const porBase = new Map<string, FilaExistente[]>();
  for (const f of existentes ?? []) {
    const lk = logicalRightKey(f);
    const bk = baseIdentityKey(f);
    (porLogica.get(lk) ?? porLogica.set(lk, []).get(lk)!).push(f);
    (porBase.get(bk) ?? porBase.set(bk, []).get(bk)!).push(f);
  }

  // Dos filas ya existentes con la misma identidad lógica: no se elige una al azar.
  for (const [k, filas] of porLogica) {
    if (filas.length > 1) {
      return { ok: false, reason: "existing_logical_duplicate", detalle: `${filas.length} filas para ${k}`, updates: [], inserts: [] };
    }
  }

  // LEGADO 1:N — antes de cualquier escritura y con independencia del orden de entrada:
  // si una fila legada (sin rol_literal) puede emparejar con más de un derecho deseado
  // que no tiene coincidencia lógica exacta, se bloquea.
  const sinExacta = deseados.filter((d) => !(porLogica.get(logicalRightKey(d)) ?? []).length);
  const porBaseDeseados = new Map<string, number>();
  for (const d of sinExacta) {
    const bk = baseIdentityKey(d);
    porBaseDeseados.set(bk, (porBaseDeseados.get(bk) ?? 0) + 1);
  }
  for (const [bk, n] of porBaseDeseados) {
    if (n < 2) continue;
    const legadas = (porBase.get(bk) ?? []).filter(esLegado);
    if (legadas.length >= 1) {
      return {
        ok: false,
        reason: "legacy_one_to_many_ambiguous",
        detalle: `${legadas.length} fila(s) legada(s) y ${n} derechos deseados para ${bk}`,
        updates: [],
        inserts: [],
      };
    }
  }

  for (const d of deseados) {
    const lk = logicalRightKey(d);
    const exacta = (porLogica.get(lk) ?? []).find((f) => !consumidas.has(f.id));
    if (exacta) {
      consumidas.add(exacta.id);
      const patch = construirPatch(exacta, d);
      if (patch.ok === false) return { ok: false, reason: patch.reason, detalle: patch.detalle, updates: [], inserts: [] };
      if (Object.keys(patch.value).length) updates.push({ id: exacta.id, patch: patch.value });
      continue;
    }

    const candidatos = (porBase.get(baseIdentityKey(d)) ?? []).filter((f) => !consumidas.has(f.id) && esLegado(f));
    if (candidatos.length > 1) {
      return {
        ok: false,
        reason: "titular_reconcile_ambiguous",
        detalle: `${candidatos.length} filas legadas para ${baseIdentityKey(d)}`,
        updates: [],
        inserts: [],
      };
    }
    if (candidatos.length === 1) {
      const f = candidatos[0];
      consumidas.add(f.id);
      const patch = construirPatch(f, d);
      if (patch.ok === false) return { ok: false, reason: patch.reason, detalle: patch.detalle, updates: [], inserts: [] };
      if (Object.keys(patch.value).length) updates.push({ id: f.id, patch: patch.value });
      continue;
    }

    inserts.push({ ...d, evidencia: parseEvidencia(d.evidencia) });
  }

  return { ok: true, updates, inserts };
}

/**
 * Patch mínimo: la evidencia SIEMPRE es la fusión existente+deseada (nunca
 * sobrescritura), y un conflicto de localizador bloquea antes de escribir.
 */
function construirPatch(
  f: FilaExistente,
  d: TitularNormalizado,
): { ok: true; value: PatchTitular } | { ok: false; reason: MotivoBloqueo; detalle: string } {
  const patch: PatchTitular = {};
  if ((f.rol ?? null) !== d.rol) patch.rol = d.rol;
  if ((f.rol_literal ?? null) !== (d.rol_literal ?? null)) patch.rol_literal = d.rol_literal;
  // El porcentaje persistido debe ser el de la fuente con 6 decimales: las
  // filas escritas con redondeo del LLM (0.11 frente a 0,109649) se corrigen.
  if (typeof d.porcentaje === "number" && Number.isFinite(d.porcentaje)) {
    const actual = f.porcentaje == null ? null : Number(f.porcentaje);
    if (actual == null || !Number.isFinite(actual) || Math.abs(actual - d.porcentaje) > 5e-7) {
      patch.porcentaje = d.porcentaje;
    }
  }
  const merged = mergeEvidencias(f.evidencia ?? null, d.evidencia ?? null);
  if (merged.ok === false) {
    return { ok: false, reason: "evidence_conflict", detalle: `${f.id}:${merged.detalle}` };
  }
  if (evidenciaStable(f.evidencia ?? null) !== evidenciaStable(merged.value)) {
    patch.evidencia = merged.value;
  }
  return { ok: true, value: patch };
}

// ---------- semántica de respuesta ----------

export type ResumenLote = {
  ok: boolean;
  status: "ok" | "partial" | "error";
  http: number;
  records_upserted: number;
  records_failed: number;
  error_message: string | null;
};

/**
 * Resultado honesto del lote: ok=true solo si fallos=0.
 * CUALQUIER fallo devuelve HTTP 500 (también el parcial), conservando status="partial".
 */
export function summarizeBatch(
  total: number,
  correctas: number,
  errores: string[] = [],
): ResumenLote & { partial: boolean } {
  const fallidas = Math.max(0, total - correctas);
  const error_message = fallidas > 0 ? (errores.filter(Boolean).join(" | ").slice(0, 1000) || "fallos sin detalle") : null;
  if (total === 0) {
    return { ok: true, status: "ok", http: 200, records_upserted: 0, records_failed: 0, error_message: null, partial: false };
  }
  if (fallidas === 0) {
    return { ok: true, status: "ok", http: 200, records_upserted: correctas, records_failed: 0, error_message: null, partial: false };
  }
  if (correctas > 0) {
    return { ok: false, status: "partial", http: 500, records_upserted: correctas, records_failed: fallidas, error_message, partial: true };
  }
  return { ok: false, status: "error", http: 500, records_upserted: 0, records_failed: fallidas, error_message, partial: false };
}

/**
 * ¿Es este titular persistido utilizable SIN volver a pedirlo al modelo?
 * Exige nombre, rol_literal explícito y EVIDENCIA REAL (fuente con localizador).
 * Los metadatos de normalización, una cita suelta o un localizador inválido
 * NO cuentan como evidencia.
 */
export function titularPersistidoEsFiable(t: any): boolean {
  if (!t || typeof t !== "object" || Array.isArray(t)) return false;
  const nombre = String(t.nombre ?? t.nombre_extraido ?? "").trim();
  if (!nombre) return false;
  const literal = t.rol_literal;
  if (typeof literal !== "string" || !literal.trim()) return false;
  return hasRealEvidence(t.evidencia);
}

/**
 * ¿Hay que pedir titulares al modelo? El schema v2 NO basta por sí solo:
 * si CUALQUIER titular actual no es fiable (sin nombre, sin rol_literal o sin
 * evidencia real con localizador), se refresca la nota ENTERA.
 */
export function needsTitularesRefetch(structured: any): boolean {
  const arr = Array.isArray(structured?.titulares) ? structured.titulares : [];
  if (arr.length === 0) return true;
  const version = Number(structured?.reparse_schema_version ?? 0);
  if (!Number.isFinite(version) || version < 2) return true;
  return arr.some((t: any) => !titularPersistidoEsFiable(t));
}

// ---------- ejecución verificable (adaptador puro y testeable) ----------

export type OpResult = { rows: number; error?: string | null };

export type FilaInsert = {
  nota_simple_id: string;
  nombre_extraido: string;
  cif_dni: string | null;
  porcentaje: number | null;
  rol: string;
  rol_literal: string | null;
  evidencia: unknown;
};

export type ReconcileRepo = {
  /** UPDATE ... RETURNING id -> debe devolver exactamente 1 fila. */
  updateTitular(id: string, patch: PatchTitular): Promise<OpResult>;
  /** INSERT ... RETURNING id -> debe devolver exactamente 1 fila. */
  insertTitular(row: FilaInsert): Promise<OpResult>;
  /** Paso de backfill previo al cierre (opcional). Si falla, NO se finaliza. */
  backfill?(): Promise<OpResult>;
  /** UPDATE notas_simples ... WHERE id=$1 AND claimed_at=$claimToken RETURNING id. */
  finalizeNota(args: { id: string; claimToken: string }): Promise<OpResult>;
};

export type ResultadoNota = {
  ok: boolean;
  reason?: string;
  detalle?: string;
  updated: number;
  inserted: number;
  finalized: boolean;
  ops: string[];
};

function exactlyOne(r: OpResult | undefined | null): boolean {
  return !!r && !r.error && r.rows === 1;
}

/**
 * Ejecuta el plan y SOLO al final finaliza la nota (una vez, y siempre en último lugar).
 * Cualquier operación que devuelva error o != 1 fila aborta sin finalizar.
 */
export async function runReconciliation(
  repo: ReconcileRepo,
  args: { notaId: string; claimToken: string; existentes: FilaExistente[]; deseados: TitularNormalizado[] },
): Promise<ResultadoNota> {
  const ops: string[] = [];
  const base: ResultadoNota = { ok: false, updated: 0, inserted: 0, finalized: false, ops };

  const plan = buildReconcilePlan(args.existentes ?? [], args.deseados ?? []);
  if (!plan.ok) {
    const f = plan as { ok: false; reason: MotivoBloqueo; detalle: string };
    return { ...base, reason: f.reason, detalle: f.detalle };
  }

  let updated = 0;
  for (const u of plan.updates) {
    const r = await repo.updateTitular(u.id, u.patch);
    ops.push(`update:${u.id}`);
    if (!exactlyOne(r)) {
      return { ...base, updated, reason: "titular_update_fail", detalle: r?.error ?? `rows=${r?.rows ?? 0}` };
    }
    updated++;
  }

  let inserted = 0;
  for (const t of plan.inserts) {
    const r = await repo.insertTitular({
      nota_simple_id: args.notaId,
      nombre_extraido: t.nombre,
      cif_dni: t.cif_dni,
      porcentaje: t.porcentaje,
      rol: t.rol,
      rol_literal: t.rol_literal,
      evidencia: t.evidencia,
    });
    ops.push(`insert:${t.nombre}`);
    if (!exactlyOne(r)) {
      return { ...base, updated, inserted, reason: "titular_insert_fail", detalle: r?.error ?? `rows=${r?.rows ?? 0}` };
    }
    inserted++;
  }

  if (repo.backfill) {
    const r = await repo.backfill();
    ops.push("backfill");
    if (!exactlyOne(r)) {
      return { ...base, updated, inserted, reason: "backfill_fail", detalle: r?.error ?? `rows=${r?.rows ?? 0}` };
    }
  }

  const fin = await repo.finalizeNota({ id: args.notaId, claimToken: args.claimToken });
  ops.push("finalize");
  if (fin?.error) {
    return { ...base, updated, inserted, reason: "finalize_fail", detalle: fin.error };
  }
  if (fin?.rows !== 1) {
    return { ...base, updated, inserted, reason: "claim_lost", detalle: `rows=${fin?.rows ?? 0}` };
  }
  return { ok: true, updated, inserted, finalized: true, ops };
}
