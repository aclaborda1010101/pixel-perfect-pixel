// Utilidades puras del reparseo de notas simples.
// Sin dependencias de Deno ni de red: testeable con vitest.

export const ROLES_CANONICOS = ["pleno", "usufructo", "nuda_propiedad", "ganancial", "otro"] as const;
export type RolCanonico = (typeof ROLES_CANONICOS)[number];

const CLAVES_PROHIBIDAS = new Set(["__proto__", "prototype", "constructor"]);

export const MAX_SANITIZE_DEPTH = 12;

export class SanitizeDepthError extends Error {
  constructor(public readonly depth: number) {
    super(`sanitize_depth_exceeded:${depth}`);
    this.name = "SanitizeDepthError";
  }
}

export type Fallo = { ok: false; reason: string; detalle?: string };
export type Result<T> = { ok: true; value: T } | Fallo;

/**
 * Quita NUL, controles C0 y C1 (U+0080–U+009F), sustituye surrogates huérfanos
 * (conserva pares válidos y \t \n \r) y normaliza a NFC.
 */
export function sanitize(s: string): string {
  // deno-lint-ignore no-control-regex
  const sinControl = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ");
  let out = "";
  for (let i = 0; i < sinControl.length; i++) {
    const c = sinControl.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = sinControl.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) {
        out += sinControl[i] + sinControl[i + 1];
        i++;
      } else {
        out += "\uFFFD";
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
    } else {
      out += sinControl[i];
    }
  }
  return out.normalize("NFC");
}

/**
 * Sanea recursivamente con límite de profundidad. Bloquea __proto__/prototype/constructor.
 * Si se excede la profundidad lanza SanitizeDepthError (fallo controlado, sin recursión ilimitada).
 */
export function sanitizeDeep<T>(value: T, depth = 0): T {
  if (depth > MAX_SANITIZE_DEPTH) throw new SanitizeDepthError(depth);
  if (typeof value === "string") return sanitize(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const safe: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = sanitize(k);
      if (CLAVES_PROHIBIDAS.has(key)) continue;
      safe[key] = sanitizeDeep(v, depth + 1);
    }
    // Copia a objeto plano (sin heredar nada peligroso): las claves prohibidas ya no existen.
    return { ...safe } as unknown as T;
  }
  return value;
}

/** Variante sin excepciones: devuelve un fallo controlado si se excede la profundidad. */
export function trySanitizeDeep<T>(value: T): Result<T> {
  try {
    return { ok: true, value: sanitizeDeep(value) };
  } catch (e) {
    if (e instanceof SanitizeDepthError) {
      return { ok: false, reason: "sanitize_depth_exceeded", detalle: String(e.depth) };
    }
    return { ok: false, reason: "sanitize_fail", detalle: String((e as Error)?.message ?? e) };
  }
}

function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normaliza un rol literal a uno canónico. Desconocido/vacío -> "otro" (NUNCA "pleno"). */
export function normalizeRol(raw: unknown): RolCanonico {
  if (raw == null) return "otro";
  const t = foldAccents(String(raw)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) return "otro";
  if (/(^| )(nuda|nudo)( |$)/.test(t) || t.includes("nuda propiedad")) return "nuda_propiedad";
  if (t.includes("usufruct")) return "usufructo";
  if (t.includes("ganancial")) return "ganancial";
  if (t === "pleno" || t === "pleno dominio" || t.includes("pleno dominio") || t.includes("plena propiedad") || t.includes("propiedad plena")) return "pleno";
  return "otro";
}

export function normalizeNombre(raw: unknown): string {
  return foldAccents(String(raw ?? "")).toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeDoc(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Normaliza el literal jurídico para comparaciones (no para mostrar). */
export function normalizeLiteral(raw: unknown): string {
  return foldAccents(String(raw ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Porcentaje seguro en (0,100]. Acepta "50,00%", 33.5, "1/2" (=50), "50/100" (=50).
 * Denominador 0, formato ambiguo, negativos, cero o >100 -> null.
 */
export function normalizePorcentaje(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  let n: number | null = null;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim().replace(/\s+/g, "").replace(/%$/, "");
    if (!s) return null;
    const frac = s.match(/^(\d+(?:[.,]\d+)?)\/(\d+(?:[.,]\d+)?)$/);
    if (frac) {
      const num = Number(frac[1].replace(",", "."));
      const den = Number(frac[2].replace(",", "."));
      if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
      n = (num / den) * 100;
    } else if (/^-?\d+(?:[.,]\d+)?$/.test(s)) {
      n = Number(s.replace(",", "."));
    } else {
      return null; // formato ambiguo
    }
  } else {
    return null;
  }
  if (n == null || !Number.isFinite(n)) return null;
  if (n <= 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Distingue porcentaje AUSENTE (ok, value null) de porcentaje NO VACÍO INVÁLIDO (fallo).
 * La regla de rango sigue siendo (0,100].
 */
export function normalizePorcentajeChecked(raw: unknown): Result<number | null> {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim() === "") return { ok: true, value: null };
  const v = normalizePorcentaje(raw);
  if (v == null) {
    return { ok: false, reason: "porcentaje_invalido", detalle: String(typeof raw === "object" ? "[objeto]" : raw).slice(0, 60) };
  }
  return { ok: true, value: v };
}

export type Evidencia = {
  cita?: string;
  pagina?: number;
  ruta?: string;
  normalizacion?: { raw_rol: string | null; raw_literal: string | null; role_conflict: boolean };
} | null;

export type TitularNormalizado = {
  nombre: string;
  cif_dni: string | null;
  porcentaje: number | null;
  rol: RolCanonico;
  rol_literal: string | null;
  evidencia: Evidencia;
};

/**
 * La evidencia NO se inventa: solo se conserva lo que el modelo devuelve.
 * - `evidencia` debe ser un objeto NO array (si no, se ignora esa fuente).
 * - `pagina` solo entero positivo.
 * - cadenas vacías se descartan.
 */
export function buildEvidencia(t: any): Evidencia {
  const src = (t?.evidencia && typeof t.evidencia === "object" && !Array.isArray(t.evidencia)) ? t.evidencia : null;
  const cita = src?.cita ?? t?.cita ?? null;
  const pagina = src?.pagina ?? t?.pagina ?? null;
  const ruta = src?.ruta ?? t?.ruta ?? null;
  const out: NonNullable<Evidencia> = {};
  if (typeof cita === "string" && sanitize(cita).trim()) out.cita = sanitize(cita).trim();
  let p: number | null = null;
  if (typeof pagina === "number") p = pagina;
  else if (typeof pagina === "string" && pagina.trim() && /^\d+$/.test(pagina.trim())) p = Number(pagina.trim());
  if (p != null && Number.isInteger(p) && p > 0) out.pagina = p;
  if (typeof ruta === "string" && sanitize(ruta).trim()) out.ruta = sanitize(ruta).trim();
  return Object.keys(out).length ? out : null;
}

/** Normalización chequeada: distingue "sin nombre" de "porcentaje no vacío inválido". */
export function normalizeTitularChecked(raw: any): Result<TitularNormalizado> {
  const san = trySanitizeDeep(raw ?? {});
  if (!san.ok) return san;
  const t: any = san.value;
  const nombre = sanitize(String(t?.nombre ?? t?.nombre_extraido ?? "")).replace(/\s+/g, " ").trim();
  if (!nombre) return { ok: false, reason: "titular_sin_nombre" };

  const pct = normalizePorcentajeChecked(t?.porcentaje);
  if (!pct.ok) {
    const f = pct as Fallo;
    return { ok: false, reason: f.reason, detalle: `${nombre}: ${f.detalle ?? ""}`.trim() };
  }

  // rol_literal SOLO de campos literales explícitos. Nunca se copia de t.rol.
  const literalRaw = t?.rol_literal ?? t?.derecho_literal ?? t?.derecho ?? null;
  const rol_literal = typeof literalRaw === "string" && literalRaw.trim() ? literalRaw.trim() : null;

  const rawRol = t?.rol == null || String(t.rol).trim() === "" ? null : String(t.rol).trim();
  const rolDesdeRol = rawRol == null ? null : normalizeRol(rawRol);
  const rolDesdeLiteral = rol_literal == null ? null : normalizeRol(rol_literal);

  // El literal jurídico manda si existe.
  const rol: RolCanonico = rolDesdeLiteral ?? rolDesdeRol ?? "otro";
  const role_conflict = rolDesdeLiteral != null && rolDesdeRol != null && rolDesdeLiteral !== rolDesdeRol;

  let evidencia = buildEvidencia(t);
  if (role_conflict) {
    evidencia = {
      ...(evidencia ?? {}),
      normalizacion: { raw_rol: rawRol, raw_literal: rol_literal, role_conflict: true },
    };
  }

  return {
    ok: true,
    value: {
      nombre,
      cif_dni: t?.cif_dni ? String(t.cif_dni).trim() : null,
      porcentaje: (pct as { ok: true; value: number | null }).value,
      rol,
      rol_literal,
      evidencia,
    },
  };
}

/** Compatibilidad: null si el titular no es utilizable. */
export function normalizeTitular(raw: any): TitularNormalizado | null {
  const r = normalizeTitularChecked(raw);
  return r.ok ? r.value : null;
}

/** Identidad base (legado): nombre + documento + porcentaje. */
export function normalizeTitularesChecked(source: unknown): Result<TitularNormalizado[]> {
  if (!Array.isArray(source) || source.length === 0) {
    return { ok: false, reason: "titulares_source_empty" };
  }
  const out: TitularNormalizado[] = [];
  for (const raw of source) {
    const r = normalizeTitularChecked(raw);
    if (!r.ok) return r as Fallo;
    out.push((r as { ok: true; value: TitularNormalizado }).value);
  }
  if (out.length === 0) return { ok: false, reason: "titulares_all_discarded" };
  return { ok: true, value: out };
}

export function titularKey(t: {
  nombre?: unknown; nombre_extraido?: unknown; cif_dni?: unknown; porcentaje?: unknown; rol?: unknown;
}): string {
  return `${normalizeNombre(t.nombre ?? t.nombre_extraido)}|${normalizeDoc(t.cif_dni)}|${normalizePorcentaje(t.porcentaje) ?? ""}|${normalizeRol(t.rol)}`;
}

/** Identidad base sin rol: para reparar filas antiguas mal clasificadas. */
export function baseIdentityKey(t: { nombre?: unknown; nombre_extraido?: unknown; cif_dni?: unknown; porcentaje?: unknown }): string {
  return `${normalizeNombre(t.nombre ?? t.nombre_extraido)}|${normalizeDoc(t.cif_dni)}|${normalizePorcentaje(t.porcentaje) ?? ""}`;
}

/** Identidad lógica de un derecho: base + rol canónico + literal normalizado. */
export function logicalRightKey(t: {
  nombre?: unknown; nombre_extraido?: unknown; cif_dni?: unknown; porcentaje?: unknown;
  rol?: unknown; rol_literal?: unknown;
}): string {
  const rolLit = normalizeLiteral(t.rol_literal);
  const rol = t.rol_literal != null && String(t.rol_literal).trim()
    ? normalizeRol(t.rol_literal)
    : normalizeRol(t.rol);
  return `${baseIdentityKey(t)}|${rol}|${rolLit}`;
}
