// PORCENTAJE EXACTO (P0.8).
//
// El porcentaje canónico de un derecho NO puede salir del redondeo del LLM
// (que devolvió 0.11 donde la nota dice 0,109649 y 1.04 donde dice 1,041667).
// Se deriva SIEMPRE de la cita/localizador de origen y se conserva con al
// menos DECIMALES_MINIMOS decimales. Módulo puro: sin Deno, sin red.

export const DECIMALES_MINIMOS = 6;

/** Redondeo a 6 decimales SIN pasar por notación exponencial. */
export function redondearExacto(n: number, decimales = DECIMALES_MINIMOS): number {
  if (!Number.isFinite(n)) return NaN;
  const f = Math.pow(10, decimales);
  // +Number.EPSILON evita que 1.0416665 caiga al lado equivocado por binario.
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
}

export type PorcentajeFuente = {
  /** Valor canónico en 0..100 con hasta 6 decimales. */
  valor: number;
  /** Literal exacto tal y como aparece en la fuente ("0,109649%", "1/2"). */
  literal: string;
  /** Cómo se obtuvo: decimal literal o fracción convertida. */
  forma: "decimal" | "fraccion";
  /** Fracción de origen, para trazabilidad exacta. */
  fraccion?: { num: number; den: number };
};

const NUM = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:\.\d+)?`;

function aNumero(literal: string): number | null {
  const s = literal.trim();
  // 1.234,56 (es) -> 1234.56 ; 1234.56 (en) -> 1234.56
  const esES = /,/.test(s);
  const limpio = esES ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^\d+(?:\.\d+)?$/.test(limpio)) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Rango registral admisible: (0..100]. */
export function enRango(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= 100;
}

/**
 * Convierte UN literal de porcentaje o fracción a valor exacto.
 * "1/2" => 50 (jamás 12). "0,109649%" => 0.109649. Fuera de (0,100] => null.
 */
export function parsePorcentajeFuente(raw: unknown): PorcentajeFuente | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, "");
  if (!s) return null;
  const sinPct = s.replace(/%$/, "");
  const frac = sinPct.match(new RegExp(`^(${NUM})\\/(${NUM})$`));
  if (frac) {
    const num = aNumero(frac[1]);
    const den = aNumero(frac[2]);
    if (num == null || den == null || den === 0) return null;
    const valor = redondearExacto((num / den) * 100);
    if (!enRango(valor)) return null;
    return { valor, literal: s, forma: "fraccion", fraccion: { num, den } };
  }
  const n = aNumero(sinPct);
  if (n == null) return null;
  const valor = redondearExacto(n);
  if (!enRango(valor)) return null;
  return { valor, literal: s, forma: "decimal" };
}

/**
 * Candidatos de porcentaje presentes en un texto (cita). Devuelve los valores
 * DISTINTOS encontrados, en orden de aparición y sin redondear.
 */
export function candidatosPorcentaje(texto: unknown): PorcentajeFuente[] {
  const t = String(texto ?? "");
  const out: PorcentajeFuente[] = [];
  const push = (p: PorcentajeFuente | null) => {
    if (!p) return;
    if (!out.some((x) => x.valor === p.valor)) out.push(p);
  };
  // 1) fracciones explícitas ("1/2 del pleno dominio")
  for (const m of t.matchAll(new RegExp(`(?<![\\d/])(${NUM})\\s*/\\s*(${NUM})(?![\\d/])`, "g"))) {
    push(parsePorcentajeFuente(`${m[1]}/${m[2]}`));
  }
  // 2) porcentajes con símbolo o con la palabra "por ciento"
  for (const m of t.matchAll(new RegExp(`(${NUM})\\s*(?:%|por\\s*ciento)`, "gi"))) {
    push(parsePorcentajeFuente(m[1]));
  }
  return out;
}

export type PorcentajeCanonico =
  | { ok: true; fuente: PorcentajeFuente; llm: number | null; discrepancia: boolean }
  | { ok: false; reason: "porcentaje_sin_fuente" | "porcentaje_ambiguo" | "porcentaje_fuera_de_rango"; detalle: string };

/**
 * Porcentaje canónico de un derecho: SIEMPRE el de la cita fuente.
 * - 0 candidatos en la cita => porcentaje_sin_fuente (bloquea).
 * - >1 candidato distinto sin localizador inequívoco => porcentaje_ambiguo.
 * - El valor del LLM se conserva sólo como diagnóstico; si difiere, gana la fuente.
 */
export function porcentajeCanonico(args: {
  cita: unknown;
  porcentajeLlm?: number | null;
  /** Si la cita trae más de un candidato, este literal desambigua (locator exacto). */
  literalEsperado?: string | null;
}): PorcentajeCanonico {
  const candidatos = candidatosPorcentaje(args.cita);
  if (!candidatos.length) {
    return { ok: false, reason: "porcentaje_sin_fuente", detalle: String(args.cita ?? "").slice(0, 120) };
  }
  let elegido: PorcentajeFuente | null = null;
  if (candidatos.length === 1) {
    elegido = candidatos[0];
  } else if (args.literalEsperado) {
    const esperado = parsePorcentajeFuente(args.literalEsperado);
    elegido = esperado ? candidatos.find((c) => c.valor === esperado.valor) ?? null : null;
    if (!elegido) {
      return {
        ok: false,
        reason: "porcentaje_ambiguo",
        detalle: `${candidatos.length} candidatos, ninguno coincide con ${args.literalEsperado}`,
      };
    }
  } else {
    return {
      ok: false,
      reason: "porcentaje_ambiguo",
      detalle: `${candidatos.length} candidatos: ${candidatos.map((c) => c.literal).join(",")}`.slice(0, 200),
    };
  }
  if (!enRango(elegido.valor)) {
    return { ok: false, reason: "porcentaje_fuera_de_rango", detalle: elegido.literal };
  }
  const llm = typeof args.porcentajeLlm === "number" && Number.isFinite(args.porcentajeLlm) ? args.porcentajeLlm : null;
  return { ok: true, fuente: elegido, llm, discrepancia: llm != null && redondearExacto(llm) !== elegido.valor };
}
