// Utilidades puras del reparseo de notas simples.
// Sin dependencias de Deno ni de red: testeable con vitest.

export const ROLES_CANONICOS = ["pleno", "usufructo", "nuda_propiedad", "ganancial", "otro"] as const;
export type RolCanonico = (typeof ROLES_CANONICOS)[number];

/**
 * DERECHOS jurídicos específicos y reconocidos. "ganancial" es un RÉGIMEN de
 * cotitularidad (no un derecho) y "otro" es desconocido: ninguno de los dos
 * puede entrar en conflicto con un derecho específico ni convertirse en pleno.
 */
export const ROLES_ESPECIFICOS = ["pleno", "usufructo", "nuda_propiedad"] as const;
export function esRolEspecifico(r: RolCanonico | null | undefined): boolean {
  return r != null && (ROLES_ESPECIFICOS as readonly string[]).includes(r);
}

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

/**
 * EVIDENCIA CANÓNICA: colección ordenada y deduplicada de FUENTES REALES.
 * Cada fuente puede llevar `cita` (texto literal no vacío) y un localizador
 * (`pagina` entero positivo, `ruta` no vacía u `offset` entero >= 0).
 * Los metadatos de normalización NUNCA son evidencia.
 */
export type EvidenciaFuente = {
  cita?: string;
  pagina?: number;
  ruta?: string;
  offset?: number;
};

export type Evidencia = { fuentes: EvidenciaFuente[] } | null;

const CLAVES_FUENTE = ["cita", "pagina", "ruta", "offset"] as const;

function enteroPositivo(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d+$/.test(v.trim())) n = Number(v.trim());
  return n != null && Number.isInteger(n) && n > 0 ? n : null;
}

function enteroNoNegativo(v: unknown): number | null {
  let n: number | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d+$/.test(v.trim())) n = Number(v.trim());
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
}

function coerceFuente(raw: unknown): EvidenciaFuente | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: EvidenciaFuente = {};
  if (typeof r.cita === "string" && sanitize(r.cita).trim()) out.cita = sanitize(r.cita).trim();
  const p = enteroPositivo(r.pagina);
  if (p != null) out.pagina = p;
  if (typeof r.ruta === "string" && sanitize(r.ruta).trim()) out.ruta = sanitize(r.ruta).trim();
  const o = enteroNoNegativo(r.offset);
  if (o != null) out.offset = o;
  return Object.keys(out).length ? out : null;
}

function fuenteStable(f: EvidenciaFuente): string {
  return CLAVES_FUENTE.map((k) => `${k}=${(f as Record<string, unknown>)[k] ?? ""}`).join("|");
}

/** Identidad de localizador: página/ruta/offset (sin la cita). */
export function fuenteLocatorKey(f: EvidenciaFuente): string {
  const partes: string[] = [];
  if (f.pagina != null) partes.push(`p:${f.pagina}`);
  if (f.ruta != null) partes.push(`r:${f.ruta.toLowerCase()}`);
  if (f.offset != null) partes.push(`o:${f.offset}`);
  if (partes.length) return partes.join("+");
  return `c:${(f.cita ?? "").toLowerCase()}`;
}

/**
 * Identidad de FUENTE = localizador normalizado + cita normalizada.
 * Dos citas reales distintas en el mismo localizador son hechos registrales
 * compatibles: se conservan ambas como dos fuentes (sin conflicto).
 */
export function fuenteIdentityKey(f: EvidenciaFuente): string {
  const loc: string[] = [];
  if (f.pagina != null) loc.push(`p:${f.pagina}`);
  if (f.ruta != null) loc.push(`r:${normalizeLiteral(f.ruta)}`);
  if (f.offset != null) loc.push(`o:${f.offset}`);
  return `${loc.join("+")}##${normalizeLiteral(f.cita ?? "")}`;
}

/** ¿La fuente tiene un localizador válido (no es solo una cita suelta)? */
export function fuenteTieneLocalizador(f: EvidenciaFuente): boolean {
  return f.pagina != null || f.ruta != null || f.offset != null;
}

/** Extrae fuentes reales de cualquier forma: canónica {fuentes}, array o legado plano. */
export function evidenciaFuentes(raw: unknown): EvidenciaFuente[] {
  const acc: EvidenciaFuente[] = [];
  const push = (f: EvidenciaFuente | null) => {
    if (!f) return;
    const s = fuenteStable(f);
    if (!acc.some((x) => fuenteStable(x) === s)) acc.push(f);
  };
  const visit = (v: unknown) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.fuentes)) o.fuentes.forEach(visit);
    push(coerceFuente(o)); // compatibilidad con el JSON legado plano
  };
  visit(raw);
  return acc;
}

/** Normaliza a evidencia canónica (null si no hay ninguna fuente real). */
export function parseEvidencia(raw: unknown): Evidencia {
  const fuentes = evidenciaFuentes(raw);
  return fuentes.length ? { fuentes } : null;
}

export type MergeEvidenciaResult =
  | { ok: true; value: Evidencia }
  | { ok: false; reason: "evidence_conflict"; detalle: string };

/**
 * Fusiona evidencias SIN PÉRDIDA: unión ordenada y deduplicada de fuentes.
 * Dos fuentes con el mismo localizador se funden campo a campo; si un mismo
 * campo pretende dos valores distintos => evidence_conflict (bloquea).
 */
export function mergeEvidencias(...entradas: unknown[]): MergeEvidenciaResult {
  const orden: string[] = [];
  const porLocalizador = new Map<string, EvidenciaFuente>();
  for (const e of entradas) {
    for (const f of evidenciaFuentes(e)) {
      const k = fuenteIdentityKey(f);
      const prev = porLocalizador.get(k);
      if (!prev) {
        porLocalizador.set(k, { ...f });
        orden.push(k);
        continue;
      }
      const merged: EvidenciaFuente = { ...prev };
      for (const campo of CLAVES_FUENTE) {
        const nuevo = (f as Record<string, unknown>)[campo];
        if (nuevo == null) continue;
        const actual = (merged as Record<string, unknown>)[campo];
        if (actual != null && actual !== nuevo) {
          // Misma identidad de fuente (localizador + cita normalizados): sólo
          // puede diferir el formato del texto. Se conserva SIEMPRE lo previo.
          continue;
        }
        (merged as Record<string, unknown>)[campo] = nuevo;
      }
      porLocalizador.set(k, merged);
    }
  }
  if (!orden.length) return { ok: true, value: null };
  // Una fuente SIN cita en un localizador que ya tiene fuente(s) con cita no
  // aporta un hecho nuevo: se absorbe (sin perder ningún campo previo).
  const conCita = new Set<string>();
  for (const k of orden) {
    const f = porLocalizador.get(k)!;
    if (f.cita) conCita.add(fuenteLocatorKey(f));
  }
  const fuentes = orden
    .map((k) => porLocalizador.get(k)!)
    .filter((f) => f.cita != null || !fuenteTieneLocalizador(f) || !conCita.has(fuenteLocatorKey(f)));
  if (!fuentes.length) return { ok: true, value: null };
  return { ok: true, value: { fuentes } };
}

/** Evidencia registral utilizable: al menos una fuente con localizador válido. */
export function hasRealEvidence(raw: unknown): boolean {
  return evidenciaFuentes(raw).some(fuenteTieneLocalizador);
}

/**
 * Evidencia ANCLADA (P0.7): al menos una fuente con CITA literal no vacía Y
 * localizador (página o ruta). Una cita suelta o un localizador sin cita no
 * prueban nada.
 */
export function citaAnclada(raw: unknown): EvidenciaFuente | null {
  for (const f of evidenciaFuentes(raw)) {
    if (f.cita && f.cita.trim() && fuenteTieneLocalizador(f)) return f;
  }
  return null;
}

/** Texto comparable: sin acentos, sin puntuación y con espacios colapsados. */
export function textoComparable(raw: unknown): string {
  return foldAccents(String(raw ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Fracción mínima de la cita que debe encontrarse literalmente en el texto. */
export const CITA_COBERTURA_MINIMA = 0.6;
const CITA_VENTANA = 5;

/**
 * ¿La cita existe REALMENTE en el texto fuente?
 *
 * En una nota simple el hecho ("TITULAR ... PARTICIPACION: 6,25% de la nuda
 * propiedad") aparece partido por saltos de página y pies de página, así que
 * exigir contención contigua exacta rechazaría citas legítimas. Se comprueba
 * por VENTANAS de 5 palabras: al menos una fracción alta de las ventanas de la cita debe
 * aparecer literalmente en el texto: al menos el 60 % (un corte de página parte
 * hasta cuatro ventanas). Un texto inventado no supera el umbral.
 *
 * Sin texto fuente (escaneado sin capa de texto) no se puede desmentir: true.
 */
export function citaVerificable(texto: string | null | undefined, cita: unknown): boolean {
  const fuente = textoComparable(texto);
  if (!fuente) return true;
  const c = textoComparable(cita);
  if (!c) return false;
  if (fuente.includes(c)) return true;
  const palabras = c.split(" ").filter(Boolean);
  if (palabras.length < CITA_VENTANA) return false;
  let total = 0;
  let encontradas = 0;
  for (let i = 0; i + CITA_VENTANA <= palabras.length; i++) {
    total++;
    if (fuente.includes(palabras.slice(i, i + CITA_VENTANA).join(" "))) encontradas++;
  }
  return total > 0 && encontradas >= 2 && encontradas / total >= CITA_COBERTURA_MINIMA;
}

/** Comparación estable de dos evidencias ya canónicas. */
export function evidenciaStable(raw: unknown): string {
  return evidenciaFuentes(raw).map(fuenteStable).join(";;");
}

export type TitularNormalizado = {
  nombre: string;
  cif_dni: string | null;
  porcentaje: number | null;
  rol: RolCanonico;
  rol_literal: string | null;
  evidencia: Evidencia;
  /** Diagnóstico NO registral (nunca evidencia, nunca se persiste como fuente). */
  rol_diagnostico?: string | null;
  /**
   * P0.8 · trazabilidad del porcentaje: qué dijo el LLM y qué dice la fuente.
   * El valor persistido (`porcentaje`) es SIEMPRE el de la fuente.
   */
  porcentaje_diagnostico?: { llm: number | null; fuente: number; literal: string; forma: string } | null;
};

/**
 * La evidencia NO se inventa: solo se conserva lo que el modelo devuelve,
 * en forma canónica {fuentes:[...]}. Acepta `evidencia` (objeto, array o
 * canónica) y también los campos sueltos cita/pagina/ruta/offset del titular.
 */
export function buildEvidencia(t: any): Evidencia {
  const merged = mergeEvidencias(
    t?.evidencia ?? null,
    { cita: t?.cita, pagina: t?.pagina, ruta: t?.ruta, offset: t?.offset },
  );
  return merged.ok ? merged.value : null;
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

  // Sólo hay conflicto si AMBOS expresan derechos jurídicos específicos y distintos.
  // "otro"/"ganancial" (desconocido / régimen) nunca bloquean ni ascienden a pleno.
  if (
    esRolEspecifico(rolDesdeLiteral) && esRolEspecifico(rolDesdeRol) &&
    rolDesdeLiteral !== rolDesdeRol
  ) {
    return {
      ok: false,
      reason: "role_conflict",
      detalle: `${nombre}: raw_rol=${rawRol} raw_literal=${rol_literal}`.slice(0, 200),
    };
  }

  // El literal jurídico reconocible PREVALECE; si no lo es, se conserva el rol declarado.
  let rol: RolCanonico;
  let rol_diagnostico: string | null = null;
  if (esRolEspecifico(rolDesdeLiteral)) {
    rol = rolDesdeLiteral as RolCanonico;
    if (rolDesdeRol != null && rolDesdeRol !== rol) {
      rol_diagnostico = `literal_prevalece:raw=${rolDesdeRol}->${rol}`;
    }
  } else if (rolDesdeRol != null) {
    rol = rolDesdeRol;
    if (rolDesdeLiteral != null && rolDesdeLiteral !== rol) {
      rol_diagnostico = `literal_no_especifico:${rolDesdeLiteral}`;
    }
  } else {
    rol = rolDesdeLiteral ?? "otro";
  }
  const evidencia = buildEvidencia(t);

  return {
    ok: true,
    value: {
      nombre,
      cif_dni: t?.cif_dni ? String(t.cif_dni).trim() : null,
      porcentaje: (pct as { ok: true; value: number | null }).value,
      rol,
      rol_literal,
      evidencia,
      rol_diagnostico,
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
  const desdeLiteral = t.rol_literal != null && String(t.rol_literal).trim()
    ? normalizeRol(t.rol_literal)
    : null;
  // Misma precedencia que normalizeTitularChecked: literal específico manda;
  // si no lo es, el rol declarado; y en su defecto el literal reconocido.
  const hayRol = t.rol != null && String(t.rol).trim() !== "";
  const rol = esRolEspecifico(desdeLiteral)
    ? (desdeLiteral as RolCanonico)
    : hayRol
      ? normalizeRol(t.rol)
      : (desdeLiteral ?? "otro");
  return `${baseIdentityKey(t)}|${rol}|${rolLit}`;
}
