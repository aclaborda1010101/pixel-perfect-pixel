/**
 * Explica en lenguaje llano de dónde sale la suma de porcentajes de propiedad
 * que se ve en la ficha. Ninguna cifra debe aparecer en pantalla sin explicar.
 */
export type ExplicacionSuma = {
  suma: number;
  nFincas?: number | null;
  titularesSinFicha?: number | null;
  pctSinFicha?: number | null;
  /** "crm" o "nota" */
  fuente?: string | null;
  /** true cuando los datos registrados mezclan fincas y suman más de 100 */
  incoherente?: boolean | null;
  /** suma bruta de los datos incoherentes, para poder nombrarla */
  sumaBruta?: number | null;
  /** estado del reparto en el edificio */
  estado?: string | null;
};

const COMPLETA_MIN = 99.25;
const COMPLETA_MAX = 100.75;

export function sumaCompleta(suma: number): boolean {
  return suma >= COMPLETA_MIN && suma <= COMPLETA_MAX;
}

function numero(n: number): string {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

/** Frase corta que dice de qué fuente vienen los porcentajes. */
export function explicaFuente(e: { fuente?: string | null; estado?: string | null }): string {
  if (e.estado === "verificado_pendiente_matching") {
    return "La nota del Registro de este edificio todavía no está enlazada con las fichas de propietario: los porcentajes que ves proceden del CRM y están pendientes de validar.";
  }
  if (e.fuente === "crm") {
    return "Porcentajes tomados de HubSpot (suman 100 %). No se mezclan con los de la nota del Registro.";
  }
  return "Porcentajes tomados de la nota del Registro.";
}

export function explicaSuma(e: ExplicacionSuma): string | null {
  if (e.incoherente) {
    const bruta = Number(e.sumaBruta ?? 0);
    return `Los porcentajes registrados de este edificio suman ${
      bruta > 0 ? `${numero(bruta)} %` : "más de 100 %"
    } porque mezclan varias fincas registrales. No se muestran hasta validarlos finca a finca: el edificio está marcado como pendiente de revisar.`;
  }

  const suma = Number(e.suma) || 0;
  if (sumaCompleta(suma)) return null;

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
    if (suma === 0) {
      return "Todavía no consta ningún porcentaje de propiedad para este edificio: la nota del Registro no está enlazada con las fichas y el CRM no tiene cuotas.";
    }
    return "La suma no llega a 100 % porque todavía no consta el porcentaje de todos los titulares.";
  }
  return `La suma no llega a 100 % porque ${partes.join("; y ")}.`;
}
