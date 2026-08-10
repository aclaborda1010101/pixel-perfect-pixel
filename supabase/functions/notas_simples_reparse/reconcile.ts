// Conciliación idempotente de derechos (titulares) de una nota simple.
// Puro: sin Deno, sin red, sin base de datos. Testeable con vitest.

import { baseIdentityKey, logicalRightKey, type TitularNormalizado } from "./lib.ts";

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
};

export type MotivoBloqueo =
  | "titular_reconcile_ambiguous"
  | "duplicate_desired_conflicting_evidence"
  | "existing_logical_duplicate";

export type PlanConciliacion =
  | { ok: true; updates: Array<{ id: string; patch: PatchTitular }>; inserts: TitularNormalizado[] }
  | { ok: false; reason: MotivoBloqueo; detalle: string; updates: []; inserts: [] };

function stable(v: unknown): string {
  if (v == null) return "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function esLegado(f: FilaExistente): boolean {
  return !f.rol_literal || !String(f.rol_literal).trim();
}

type Ev = Record<string, unknown> | null;

/**
 * Fusiona dos evidencias: null + X = X; claves compartidas con valores distintos = conflicto.
 */
export function mergeEvidencia(a: unknown, b: unknown): { ok: true; value: Ev } | { ok: false } {
  const oa = (a && typeof a === "object" && !Array.isArray(a)) ? a as Record<string, unknown> : null;
  const ob = (b && typeof b === "object" && !Array.isArray(b)) ? b as Record<string, unknown> : null;
  if (a != null && oa == null) return { ok: false };
  if (b != null && ob == null) return { ok: false };
  if (oa == null) return { ok: true, value: ob };
  if (ob == null) return { ok: true, value: oa };
  const out: Record<string, unknown> = { ...oa };
  for (const [k, v] of Object.entries(ob)) {
    if (k in out && stable(out[k]) !== stable(v)) return { ok: false };
    out[k] = v;
  }
  return { ok: true, value: out };
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
  const ded = dedupeDeseados(deseadosRaw ?? []);
  if (!ded.ok) return { ok: false, reason: ded.reason, detalle: ded.detalle, updates: [], inserts: [] };
  const deseados = ded.value;

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

  for (const d of deseados) {
    const lk = logicalRightKey(d);
    const exacta = (porLogica.get(lk) ?? []).find((f) => !consumidas.has(f.id));
    if (exacta) {
      consumidas.add(exacta.id);
      const patch: PatchTitular = {};
      if ((exacta.rol ?? null) !== d.rol) patch.rol = d.rol;
      if ((exacta.rol_literal ?? null) !== (d.rol_literal ?? null)) patch.rol_literal = d.rol_literal;
      if (d.evidencia != null && stable(exacta.evidencia ?? null) !== stable(d.evidencia)) patch.evidencia = d.evidencia;
      if (Object.keys(patch).length) updates.push({ id: exacta.id, patch });
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
      const patch: PatchTitular = {};
      if ((f.rol ?? null) !== d.rol) patch.rol = d.rol;
      if ((f.rol_literal ?? null) !== (d.rol_literal ?? null)) patch.rol_literal = d.rol_literal;
      if (d.evidencia != null && stable(f.evidencia ?? null) !== stable(d.evidencia)) patch.evidencia = d.evidencia;
      if (Object.keys(patch).length) updates.push({ id: f.id, patch });
      continue;
    }

    inserts.push(d);
  }

  return { ok: true, updates, inserts };
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

/** ¿Hay que pedir titulares al modelo? */
export function needsTitularesRefetch(structured: any): boolean {
  const arr = Array.isArray(structured?.titulares) ? structured.titulares : [];
  if (arr.length === 0) return true;
  const version = Number(structured?.reparse_schema_version ?? 0);
  if (!Number.isFinite(version) || version < 2) return true;
  return arr.some((t: any) => !t?.rol_literal || t?.evidencia == null);
}
