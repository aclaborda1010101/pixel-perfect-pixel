// Utilidades puras del reparseo de notas simples.
// Sin dependencias de Deno ni de red: testeable con vitest.

export const ROLES_CANONICOS = ["pleno", "usufructo", "nuda_propiedad", "ganancial", "otro"] as const;
export type RolCanonico = (typeof ROLES_CANONICOS)[number];

/** Quita NUL y caracteres de control que Postgres rechaza. Conserva \t \n \r y todo Unicode válido. */
export function sanitize(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

/** Sanea recursivamente cualquier string dentro de objetos/arrays devueltos por el modelo. */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") return sanitize(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[sanitize(k)] = sanitizeDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normaliza un rol literal a uno de los roles canónicos. Desconocido/vacío -> "otro" (NUNCA "pleno"). */
export function normalizeRol(raw: unknown): RolCanonico {
  if (raw == null) return "otro";
  const t = foldAccents(String(raw)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) return "otro";
  if (/(^| )(nuda|nudo)( |$)/.test(t) || t.includes("nuda propiedad") || t.includes("nuda_propiedad")) return "nuda_propiedad";
  if (t.includes("usufruct")) return "usufructo";
  if (t.includes("ganancial")) return "ganancial";
  if (t === "pleno" || t.includes("pleno dominio") || t.includes("plena propiedad") || t === "pleno_dominio" || t.includes("propiedad plena")) return "pleno";
  return "otro";
}

export function normalizeNombre(raw: unknown): string {
  return foldAccents(String(raw ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeDoc(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizePorcentaje(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9,.\-]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export type EvidenciaModelo = { cita?: string | null; pagina?: number | null; ruta?: string | null } | null;

export type TitularNormalizado = {
  nombre: string;
  cif_dni: string | null;
  porcentaje: number | null;
  rol: RolCanonico;
  rol_literal: string | null;
  evidencia: { cita?: string; pagina?: number; ruta?: string } | null;
};

/** La evidencia NO se inventa: solo se conserva lo que el modelo devuelve. */
function buildEvidencia(t: any): TitularNormalizado["evidencia"] {
  const src = (t?.evidencia && typeof t.evidencia === "object") ? t.evidencia : null;
  const cita = src?.cita ?? t?.cita ?? null;
  const pagina = src?.pagina ?? t?.pagina ?? null;
  const ruta = src?.ruta ?? t?.ruta ?? null;
  const out: { cita?: string; pagina?: number; ruta?: string } = {};
  if (typeof cita === "string" && cita.trim()) out.cita = sanitize(cita).trim();
  const p = typeof pagina === "number" ? pagina : (typeof pagina === "string" && pagina.trim() ? Number(pagina) : null);
  if (p != null && Number.isFinite(p)) out.pagina = p;
  if (typeof ruta === "string" && ruta.trim()) out.ruta = sanitize(ruta).trim();
  return Object.keys(out).length ? out : null;
}

export function normalizeTitular(raw: any): TitularNormalizado | null {
  const t = sanitizeDeep(raw ?? {});
  const nombre = String(t?.nombre ?? "").replace(/\s+/g, " ").trim();
  if (!nombre) return null;
  const literalRaw = t?.rol_literal ?? t?.derecho_literal ?? t?.derecho ?? t?.rol ?? null;
  const rol_literal = typeof literalRaw === "string" && literalRaw.trim() ? literalRaw.trim() : null;
  return {
    nombre,
    cif_dni: t?.cif_dni ? String(t.cif_dni).trim() : null,
    porcentaje: normalizePorcentaje(t?.porcentaje),
    rol: normalizeRol(t?.rol ?? literalRaw),
    rol_literal,
    evidencia: buildEvidencia(t),
  };
}

/** Clave de deduplicación: nombre + documento + porcentaje + rol canónico. */
export function titularKey(t: {
  nombre?: unknown; nombre_extraido?: unknown; cif_dni?: unknown; porcentaje?: unknown; rol?: unknown;
}): string {
  const nombre = normalizeNombre(t.nombre ?? t.nombre_extraido);
  const doc = normalizeDoc(t.cif_dni);
  const pct = normalizePorcentaje(t.porcentaje);
  const rol = normalizeRol(t.rol);
  return `${nombre}|${doc}|${pct ?? ""}|${rol}`;
}
