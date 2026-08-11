/**
 * FIXTURE REAL P0.11 — morfología EXACTA del canario 71c01af3…:
 *   · 0 saltos de línea, 12 marcadores de página
 *   · SOLO 2 ocurrencias de "TITULAR:" en todo el documento
 *   · 66 tokens PARTICIPACION dentro de [TITULARIDADES, CARGAS) y 2 en CARGAS
 *   · identidad SIEMPRE antes del token, ruido numérico de tomo/libro/folio
 *   · "TITULO: Adquirida por HERENCIA/HIPOTECA…" con porcentajes históricos
 *   · HIPOTECA narrativa dentro de la ventana (no abre cargas)
 * Datos anonimizados; separadores, orden y distancias relativas son los reales.
 */
export const P11_PLENO = 38;
export const P11_NUDA = 20;
export const P11_USUFRUCTO = 8;
export const P11_DERECHOS = P11_PLENO + P11_NUDA + P11_USUFRUCTO; // 66
export const P11_CARGAS = 2;
export const P11_PAGINAS = 12;
export const P11_CHARS_APROX = 27574;

const APELLIDOS = [
  "LOPEZ SERRANO", "PEREZ CALVO", "RUIZ MOLINA", "GARCIA ORTEGA", "DIAZ NAVARRO",
  "SANZ MERINO", "VEGA CASTRO", "SOTO LARA", "MARIN PRIETO", "CANO ROMERO",
  "BRAVO PARDO", "NIETO GIL",
];
const NOMBRES = ["MARIA", "JUAN", "ANA", "LUIS", "CARMEN", "PABLO", "ELENA", "MIGUEL"];

export type HechoP11 = {
  idx: number;
  nombre: string | null;
  doc: string | null;
  derecho: "pleno" | "nuda_propiedad" | "usufructo";
  literal: string;
  porcentaje: number;
  /** Caso especial cubierto por este hecho. */
  caso?: string;
};

function pct(i: number): string {
  const v = ((i * 7919) % 890000) / 1000000 + 0.05;
  return v.toFixed(6).replace(".", ",");
}

const DERECHOS: Array<HechoP11["derecho"]> = [
  ...Array(P11_PLENO).fill("pleno"),
  ...Array(P11_NUDA).fill("nuda_propiedad"),
  ...Array(P11_USUFRUCTO).fill("usufructo"),
];

const LITERAL: Record<HechoP11["derecho"], string> = {
  pleno: "del pleno dominio",
  nuda_propiedad: "de la nuda propiedad",
  usufructo: "del usufructo",
};

/** Oráculo: los 66 hechos esperados, en orden documental. */
export const HECHOS_P11: HechoP11[] = DERECHOS.map((derecho, i) => {
  const literal = pct(i);
  // Caso "dos derechos del mismo titular": 37 (pleno) y 38 (nuda) comparten identidad.
  const ident = i === 38 ? 37 : i;
  const esSociedad = i === 30;
  const sinDni = i === 31;
  const nombre = esSociedad
    ? "PATRIMONIAL DEL NORTE SL"
    : `${APELLIDOS[ident % APELLIDOS.length]}, ${NOMBRES[ident % NOMBRES.length]}`;
  const doc = esSociedad ? "B12345678" : sinDni ? null : `${String(10000000 + ident * 137).slice(0, 8)}${"TRWAGMYFPD"[ident % 10]}`;
  return {
    idx: i,
    nombre,
    doc,
    derecho,
    literal: `${literal}%`,
    porcentaje: Number(literal.replace(",", ".")),
    caso: esSociedad ? "cif_sociedad" : sinDni ? "identidad_sin_dni" : i === 38 ? "dos_derechos_mismo_titular" : undefined,
  };
});

/** Construye el raw: UNA sola línea, sin marcadores TITULAR: fabricados. */
export function buildCanaryP11(): string {
  let s = "REGISTRO DE LA PROPIEDAD DE VILLANUEVA NUMERO 3. NOTA SIMPLE INFORMATIVA CONTINUADA. IDUFIR 28001000123456. FINCA REGISTRAL 12345. ";
  s += "DESCRIPCION: URBANA. EDIFICIO SITUADO EN LA CALLE MAYOR NUM 33, COMPUESTO DE DOCE VIVIENDAS Y DOS LOCALES COMERCIALES, CON UNA SUPERFICIE DE 1.240 METROS CUADRADOS. ANEJOS: DOS TRASTEROS Y UN PATIO SL. ";
  // Las DOS únicas ocurrencias de "TITULAR:" del documento real.
  s += "AVISO: LA CONDICION DE TITULAR: se acredita unicamente por la inscripcion vigente. ";
  s += "EL HISTORICO DE TITULAR: anterior no consta en esta nota informativa. ";
  s += "TITULARIDADES ";

  const porPagina = Math.ceil(P11_DERECHOS / (P11_PAGINAS - 1));
  HECHOS_P11.forEach((h, i) => {
    if (i > 0 && i % porPagina === 0) {
      // Fin de página PEGADO al texto (sin espacio previo en el caso 24).
      s += i === 24 ? `Pagina ${Math.floor(i / porPagina) + 1} de ${P11_PAGINAS}` : ` Pagina ${Math.floor(i / porPagina) + 1} de ${P11_PAGINAS} `;
    }
    // IDENTIDAD ANTES DEL TOKEN + ruido numérico registral tras el documento.
    s += `${h.nombre}${h.doc ? ` ${h.doc}` : ""} Tomo ${1200 + i} Libro ${30 + (i % 9)} Folio ${(i * 7) % 250} Inscripcion ${1 + (i % 6)} `;
    s += `PARTICIPACION: ${h.literal} ${LITERAL[h.derecho]} de la finca. `;
    // TITULO con porcentajes HISTÓRICOS: son antecedentes, nunca otro hecho.
    s += i % 2 === 0
      ? `TITULO: Adquirida por HERENCIA formalizada en escritura publica, en la que se adjudico un 12,500000% y previamente un 4,000000% de la misma finca. `
      : `TITULO: Adquirida por COMPRAVENTA con subrogacion en HIPOTECA que gravaba el 100,000000% del pleno dominio segun inscripcion anterior. `;
    s += `Nota al margen: la inscripcion ${1 + (i % 6)} fue extendida en el tomo ${1200 + i} del archivo, libro ${30 + (i % 9)} de la seccion tercera, folio ${(i * 7) % 250}, asiento ${400 + i}. `;
    if (i === 39) {
      s += "HIPOTECA mencionada exclusivamente en el titulo de adquisicion y cancelada con anterioridad; esta frase narrativa no abre la seccion de cargas. ";
    }
  });

  s += ` Pagina ${P11_PAGINAS} de ${P11_PAGINAS} `;
  s += "CARGAS Y GRAVAMENES: HIPOTECA a favor de BANCO DEL NORTE SA, responsabilidad hipotecaria con PARTICIPACION 100,000000% sobre la finca, inscripcion 7a; ";
  s += "AFECCION fiscal por liquidacion del impuesto con PARTICIPACION 12,500000% durante cinco anos, nota al margen. ";
  s += "FIN DE LA NOTA SIMPLE INFORMATIVA. ESTE DOCUMENTO NO ES CERTIFICACION. ";
  if (s.includes("\n")) throw new Error("el fixture no puede contener saltos de línea");
  return s;
}
