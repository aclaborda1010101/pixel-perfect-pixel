/**
 * REGLA ÚNICA del estado de propiedad de un edificio.
 *
 * El estado NO es un valor que alguien escribe: es una consecuencia de los datos.
 * Este archivo es el espejo en TypeScript de la vista `v_building_estado_calculado`
 * y de la función `recalcular_porcentajes_estado()` de la base de datos.
 * Si cambia la regla, cambia aquí y allí, y las pruebas lo verifican.
 */
export type EstadoPropiedad =
  | "verificado"
  | "verificado_pendiente_matching"
  | "a_revisar"
  | "sin_propietarios"
  | "sin_nota";

export const SUMA_MIN = 99.25;
export const SUMA_MAX = 100.75;

export type DatosEdificio = {
  /** personas cargadas en el edificio */
  nPersonas: number;
  /** suma visible de porcentajes de propiedad */
  suma: number;
  /** titulares de la nota registral (0 = no hay nota con titulares) */
  nTitulares?: number | null;
  /** titulares de la nota sin ficha de contacto */
  titularesSinFicha?: number | null;
};

export function sumaCuadra(suma: number): boolean {
  return suma >= SUMA_MIN && suma <= SUMA_MAX;
}

export function estadoDesdeDatos(d: DatosEdificio): EstadoPropiedad {
  const suma = Number(d.suma) || 0;
  const titulares = Number(d.nTitulares ?? 0);
  const sinFicha = Number(d.titularesSinFicha ?? 0);
  if (Number(d.nPersonas) <= 0) return "sin_propietarios";
  if (suma === 0 && titulares === 0) return "sin_nota";
  if (sumaCuadra(suma)) return sinFicha > 0 ? "verificado_pendiente_matching" : "verificado";
  return "a_revisar";
}

export const ESTADO_LABEL: Record<EstadoPropiedad, string> = {
  verificado: "Verificado",
  verificado_pendiente_matching: "Pendiente de emparejar",
  a_revisar: "En revisión",
  sin_propietarios: "Sin propietarios",
  sin_nota: "Sin nota",
};

function numero(n: number): string {
  return n.toLocaleString("es-ES", { maximumFractionDigits: 2 });
}

/** Una línea, sin jerga, que explica el estado que ve el comercial. */
export function explicaEstado(
  estado: string | null | undefined,
  ctx: { suma?: number | null; titularesSinFicha?: number | null; nFincas?: number | null } = {},
): string {
  const suma = Number(ctx.suma ?? 0);
  const sinFicha = Number(ctx.titularesSinFicha ?? 0);
  const fincas = Number(ctx.nFincas ?? 0);

  switch (estado) {
    case "verificado":
      return "Verificado contra el Registro: la propiedad suma 100 % y todos los titulares están dados de alta.";
    case "verificado_pendiente_matching":
      return sinFicha > 0
        ? `Los porcentajes cuadran, ${
            sinFicha === 1 ? "falta 1 propietario" : `faltan ${sinFicha} propietarios`
          } por dar de alta.`
        : "Los porcentajes cuadran, falta emparejar los titulares de la nota con sus fichas.";
    case "a_revisar":
      return fincas > 1
        ? `El reparto está en revisión: la suma es ${numero(suma)} % y el edificio tiene ${fincas} fincas registrales, que se validan una a una.`
        : `El reparto está en revisión: la suma ${suma > SUMA_MAX ? "pasa de" : "no llega a"} 100 % (${numero(suma)} %).`;
    case "sin_propietarios":
      return "Aún no hay propietarios cargados: pulsa Actualizar para traerlos de HubSpot.";
    case "sin_nota":
      return "No hay nota del Registro ni cuotas en el CRM: la primera acción es conseguir la nota.";
    default:
      return "Estado de la propiedad sin determinar todavía.";
  }
}