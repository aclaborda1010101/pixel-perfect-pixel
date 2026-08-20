/**
 * Explica en lenguaje llano por qué la suma de porcentajes de propiedad que se
 * ve en la ficha no llega al 100 %. El número nunca debe aparecer solo.
 */
export type ExplicacionSuma = {
  suma: number;
  nFincas?: number | null;
  titularesSinFicha?: number | null;
  pctSinFicha?: number | null;
  fuente?: string | null;
};

const COMPLETA_MIN = 99.25;
const COMPLETA_MAX = 100.75;

export function sumaCompleta(suma: number): boolean {
  return suma >= COMPLETA_MIN && suma <= COMPLETA_MAX;
}

function numero(n: number): string {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

export function explicaSuma(e: ExplicacionSuma): string | null {
  const suma = Number(e.suma) || 0;
  if (sumaCompleta(suma)) return null;
  if (suma > COMPLETA_MAX) {
    return `La suma pasa de 100 %: hay porcentajes repetidos o mal leídos. Está listado en el Orquestador para revisarlo.`;
  }

  const partes: string[] = [];
  const fincas = Number(e.nFincas ?? 0);
  if (fincas > 1) {
    partes.push(
      `este edificio tiene ${fincas} fincas registrales y los porcentajes se validan finca a finca, nunca sumando fincas distintas`,
    );
  }
  const sinFicha = Number(e.titularesSinFicha ?? 0);
  if (sinFicha > 0) {
    const pct = Number(e.pctSinFicha ?? 0);
    partes.push(
      `faltan ${sinFicha} ${sinFicha === 1 ? "propietario" : "propietarios"} por dar de alta${
        pct > 0 ? `, que representan un ${numero(pct)} %` : ""
      }`,
    );
  }

  if (partes.length === 0) {
    return `La suma no llega a 100 % porque todavía no consta el porcentaje de todos los titulares.`;
  }
  const cuerpo = partes.join("; y ");
  return `La suma no llega a 100 % porque ${cuerpo}.`;
}
