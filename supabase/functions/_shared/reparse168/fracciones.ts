// FRACCIONES EN LETRA (reparseo de notas 'a revisar').
//
// El extractor antiguo sólo veía cifras ("6,250000%", "1/35") y se saltaba los
// derechos escritos en letra ("una sexta parte indivisa de la nuda propiedad
// sobre una séptima parte indivisa de una quinta parte"), que son fracciones
// COMPUESTAS: se multiplican entre sí. Módulo puro: sin red, sin base.

const ORDINALES: Record<string, number> = {
  mitad: 2, media: 2,
  tercio: 3, tercia: 3, tercera: 3, terceras: 3, tercios: 3,
  cuarta: 4, cuartas: 4, cuarto: 4, cuartos: 4,
  quinta: 5, quintas: 5, quinto: 5, quintos: 5,
  sexta: 6, sextas: 6, sexto: 6, sextos: 6,
  septima: 7, septimas: 7, septimo: 7, septimos: 7,
  octava: 8, octavas: 8, octavo: 8, octavos: 8,
  novena: 9, novenas: 9, noveno: 9, novenos: 9,
  decima: 10, decimas: 10, decimo: 10, decimos: 10,
  onceava: 11, onceavas: 11, undecima: 11, undecimas: 11,
  doceava: 12, doceavas: 12, duodecima: 12, duodecimas: 12,
  treceava: 13, treceavas: 13, catorceava: 14, catorceavas: 14,
  quinceava: 15, quinceavas: 15, dieciseisava: 16, dieciseisavas: 16,
  veinteava: 20, veinteavas: 20, veinticuatroava: 24, veinticuatroavas: 24,
  treintava: 30, treintavas: 30, treintaava: 30, cuarentava: 40, cuarentavas: 40,
};

const CARDINALES: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20,
};

/** Quita tildes y baja a minúsculas: "séptima" -> "septima". */
export function normalizarTexto(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type FraccionLetra = { num: number; den: number; literal: string; index: number };

/**
 * Fracciones en letra del texto, en orden de aparición.
 * Acepta "una mitad", "dos terceras partes", "una séptima parte indivisa".
 */
export function fraccionesEnLetra(texto: string): FraccionLetra[] {
  const plano = normalizarTexto(texto);
  const out: FraccionLetra[] = [];
  const re = new RegExp(
    String.raw`\b(${Object.keys(CARDINALES).join("|")})\s+(${Object.keys(ORDINALES).join("|")})\b(?:\s+partes?)?`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(plano))) {
    const num = CARDINALES[m[1]];
    const den = ORDINALES[m[2]];
    if (!num || !den) continue;
    out.push({ num, den, literal: texto.slice(m.index, m.index + m[0].length), index: m.index });
  }
  return out;
}

export type ValorDerecho = {
  /** Porcentaje 0..100 con 6 decimales. */
  porcentaje: number;
  literal: string;
  forma: "porcentaje" | "fraccion_numerica" | "fraccion_letra";
};

const RE_PCT = /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:\.\d+)?)\s*%/g;
const RE_FRAC = /(?<![\d,.])(\d{1,6})\s*\/\s*(\d{1,6})(?![\d/])/g;

function redondear6(n: number): number {
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 1e6) / 1e6;
}

function aNumero(s: string): number {
  return Number(/,/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s);
}

/**
 * Valor del derecho descrito en UN tramo de hecho.
 * Prioridad: porcentaje explícito > fracción numérica > fracciones en letra
 * (multiplicadas entre sí, que es como se expresa la participación compuesta).
 */
export function valorDerecho(tramo: string): ValorDerecho | null {
  const texto = String(tramo ?? "");
  RE_PCT.lastIndex = 0;
  const pct = RE_PCT.exec(texto);
  if (pct) {
    const v = redondear6(aNumero(pct[1]));
    if (v > 0 && v <= 100) return { porcentaje: v, literal: pct[0].trim(), forma: "porcentaje" };
  }
  RE_FRAC.lastIndex = 0;
  const fr = RE_FRAC.exec(texto);
  if (fr) {
    const den = Number(fr[2]);
    const v = den ? redondear6((Number(fr[1]) / den) * 100) : NaN;
    if (v > 0 && v <= 100) return { porcentaje: v, literal: fr[0].trim(), forma: "fraccion_numerica" };
  }
  const letras = fraccionesEnLetra(texto);
  if (letras.length) {
    const producto = letras.reduce((acc, f) => acc * (f.num / f.den), 1);
    const v = redondear6(producto * 100);
    if (v > 0 && v <= 100) {
      return { porcentaje: v, literal: letras.map((f) => f.literal).join(" x "), forma: "fraccion_letra" };
    }
  }
  return null;
}
