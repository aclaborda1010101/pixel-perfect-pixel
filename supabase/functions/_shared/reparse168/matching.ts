// EMPAREJADO DETERMINISTA titular ↔ propietario/empresa YA EXISTENTE.
// Nunca crea fichas nuevas: si no hay candidato claro, el titular queda sin
// vincular y el edificio pasa a "verificado_pendiente_matching".
// Módulo puro: sin Deno, sin red, sin base de datos.

export const UMBRAL_OWNER = 0.6;
export const MARGEN_AMBIGUEDAD = 0.05;
export const UMBRAL_EMPRESA = 0.82;

const TRATAMIENTOS = /\b(DON|DONA|DOÑA|DNA|SR|SRA|SRES|HEREDEROS DE|VIUDA DE|VDA)\b/g;

export function normalizarNombre(s: unknown): string {
  return String(s ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(TRATAMIENTOS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "APELLIDO1 APELLIDO2, NOMBRE" -> "NOMBRE APELLIDO1 APELLIDO2". */
export function reordenarComa(s: string): string {
  const i = s.indexOf(",");
  if (i <= 0) return s;
  return `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`.replace(/\s+/g, " ").trim();
}

function bigramas(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Similitud de Dice sobre bigramas (0..1). */
export function similitud(a: string, b: string): number {
  const x = normalizarNombre(a);
  const y = normalizarNombre(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigramas(x);
  const B = bigramas(y);
  const cuenta = new Map<string, number>();
  for (const g of A) cuenta.set(g, (cuenta.get(g) ?? 0) + 1);
  let comunes = 0;
  for (const g of B) {
    const n = cuenta.get(g) ?? 0;
    if (n > 0) { comunes++; cuenta.set(g, n - 1); }
  }
  return (2 * comunes) / (A.length + B.length);
}

/** Mejor similitud probando el nombre directo y la forma "APELLIDOS, NOMBRE". */
export function similitudNombre(a: string, b: string): number {
  return Math.max(
    similitud(a, b),
    similitud(reordenarComa(String(a ?? "")), b),
    similitud(a, reordenarComa(String(b ?? ""))),
  );
}

export function normalizarDoc(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type Candidato = { id: string; nombre: string; cif?: string | null };

export type Emparejado = { id: string | null; score: number; motivo: string };

/** Propietario del MISMO edificio: umbral 0,60 con margen anti-ambigüedad. */
export function emparejarOwner(nombre: string, candidatos: Candidato[]): Emparejado {
  const puntuados = candidatos
    .map((c) => ({ c, s: similitudNombre(nombre, c.nombre) }))
    .sort((a, b) => b.s - a.s);
  if (!puntuados.length) return { id: null, score: 0, motivo: "sin_candidatos" };
  const [mejor, segundo] = puntuados;
  if (mejor.s < UMBRAL_OWNER) return { id: null, score: mejor.s, motivo: "por_debajo_umbral" };
  if (segundo && mejor.s - segundo.s < MARGEN_AMBIGUEDAD) {
    return { id: null, score: mejor.s, motivo: "ambiguo" };
  }
  return { id: mejor.c.id, score: mejor.s, motivo: "nombre" };
}

/** Empresa por CIF exacto o por nombre ≥ 0,82. */
export function emparejarEmpresa(nombre: string, doc: string | null, candidatos: Candidato[]): Emparejado {
  const d = normalizarDoc(doc);
  if (d) {
    const porCif = candidatos.find((c) => normalizarDoc(c.cif) === d);
    if (porCif) return { id: porCif.id, score: 1, motivo: "cif" };
  }
  const puntuados = candidatos
    .map((c) => ({ c, s: similitudNombre(nombre, c.nombre) }))
    .sort((a, b) => b.s - a.s);
  if (puntuados.length && puntuados[0].s >= UMBRAL_EMPRESA) {
    return { id: puntuados[0].c.id, score: puntuados[0].s, motivo: "nombre" };
  }
  return { id: null, score: puntuados[0]?.s ?? 0, motivo: "sin_empresa" };
}

const RE_SOCIEDAD = /\b(S\.?\s?L\.?|S\.?\s?A\.?|S\.?\s?L\.?U\.?|SOCIEDAD|INMOBILIARIA|PROMOCIONES|INVERSIONES|COMUNIDAD DE BIENES|C\.?B\.?|FUNDACION|ASOCIACION|BANCO|IGLESIA|AYUNTAMIENTO)\b/;

export function esSociedad(nombre: string, doc: string | null): boolean {
  if (/^[ABCDEFGHJNPQRSUVW]\d{7,8}[A-Z0-9]?$/.test(normalizarDoc(doc))) return true;
  return RE_SOCIEDAD.test(normalizarNombre(nombre));
}
