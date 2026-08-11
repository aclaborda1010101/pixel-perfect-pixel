/**
 * FIXTURE REALISTA P0.9 — morfología EXACTA del canario 71c01af3…:
 *   27.574 caracteres, CERO "\n", 12 marcadores de página,
 *   66 derechos registrales (38 pleno + 20 nuda propiedad + 8 usufructo)
 *   y 2 participaciones dentro de cargas/hipotecas (que NO son titulares).
 * Datos anonimizados; la forma del texto es la real (una sola línea).
 */
export const CANARY_CHARS = 27574;
export const CANARY_PAGINAS = 12;
export const CANARY_PLENO = 38;
export const CANARY_NUDA = 20;
export const CANARY_USUFRUCTO = 8;
export const CANARY_DERECHOS = CANARY_PLENO + CANARY_NUDA + CANARY_USUFRUCTO; // 66
export const CANARY_CARGAS = 2;

const NOMBRES = [
  "MARIA LOPEZ SERRANO", "JUAN PEREZ CALVO", "ANA RUIZ MOLINA", "LUIS GARCIA ORTEGA",
  "CARMEN DIAZ NAVARRO", "PABLO SANZ MERINO", "ELENA VEGA CASTRO", "MIGUEL SOTO LARA",
  "ROSA MARIN PRIETO", "DAVID CANO ROMERO", "LAURA BRAVO PARDO", "SERGIO NIETO GIL",
];

function nombreDe(i: number): string {
  return `${NOMBRES[i % NOMBRES.length]} ${romano(i + 1)}`;
}
function romano(n: number): string {
  const t = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return `${t[Math.floor(n / 10) % 11]}${t[n % 10]}` || "I";
}
function dniDe(i: number): string {
  return `${String(10000000 + i * 137).slice(0, 8)}${"TRWAGMYFPD"[i % 10]}`;
}
/** Porcentajes con 6 decimales reales: nada de 0,11 ni 1,04. */
function pctDe(i: number): string {
  const v = ((i * 7919) % 900000) / 1000000 + 0.05; // 0,05…0,95 aprox
  return v.toFixed(6).replace(".", ",");
}
const DERECHOS: Array<{ literal: string }> = [];
for (let i = 0; i < CANARY_PLENO; i++) DERECHOS.push({ literal: "pleno dominio" });
for (let i = 0; i < CANARY_NUDA; i++) DERECHOS.push({ literal: "nuda propiedad" });
for (let i = 0; i < CANARY_USUFRUCTO; i++) DERECHOS.push({ literal: "usufructo vitalicio" });

export type HechoFixture = {
  nombre: string;
  dni: string;
  porcentaje_literal: string;
  porcentaje: number;
  derecho: "pleno" | "nuda_propiedad" | "usufructo";
  cita: string;
};

/** Los 66 hechos esperados (oráculo del test). */
export const HECHOS_CANARY: HechoFixture[] = DERECHOS.map((d, i) => {
  const nombre = nombreDe(i);
  const dni = dniDe(i);
  const lit = pctDe(i);
  const cita = `TITULAR: ${nombre}, DNI ${dni}, PARTICIPACION ${lit}% en ${d.literal} por titulo de compraventa.`;
  return {
    nombre,
    dni,
    porcentaje_literal: `${lit}%`,
    porcentaje: Number(lit.replace(",", ".")),
    derecho: d.literal === "pleno dominio" ? "pleno" : d.literal === "nuda propiedad" ? "nuda_propiedad" : "usufructo",
    cita,
  };
});

/** Construye el texto del canario: una sola línea, 12 páginas, 27.574 chars. */
export function buildCanaryText(): string {
  let s = "REGISTRO DE LA PROPIEDAD DE VILLANUEVA NUMERO 3. NOTA SIMPLE INFORMATIVA. IDUFIR 28001000123456. FINCA 12345. ";
  s += "DESCRIPCION: URBANA. EDIFICIO SITO EN CALLE MAYOR NUMERO 33, COMPUESTO DE DOCE VIVIENDAS Y DOS LOCALES. ";
  s += "TITULARIDADES: ";
  const porPagina = Math.ceil(HECHOS_CANARY.length / (CANARY_PAGINAS - 1));
  HECHOS_CANARY.forEach((h, i) => {
    if (i > 0 && i % porPagina === 0) {
      s += `Pagina ${Math.floor(i / porPagina) + 1} de ${CANARY_PAGINAS} `;
    }
    s += `${h.cita} `;
  });
  s += `Pagina ${CANARY_PAGINAS} de ${CANARY_PAGINAS} `;
  s += "CARGAS Y GRAVAMENES: HIPOTECA a favor de BANCO DEL NORTE SA, responsabilidad hipotecaria con PARTICIPACION 100,000000% sobre la finca, inscripcion 7a; ";
  s += "AFECCION fiscal por liquidacion del impuesto con PARTICIPACION 12,500000% durante cinco anos, nota al margen. ";
  s += "FIN DE LA NOTA SIMPLE INFORMATIVA. ESTE DOCUMENTO NO ES CERTIFICACION. ";
  if (s.length > CANARY_CHARS) throw new Error(`fixture demasiado largo: ${s.length}`);
  s += " ".repeat(CANARY_CHARS - s.length);
  if (s.length !== CANARY_CHARS) throw new Error(`fixture ${s.length} != ${CANARY_CHARS}`);
  if (s.includes("\n")) throw new Error("el fixture no puede contener saltos de línea");
  return s;
}
