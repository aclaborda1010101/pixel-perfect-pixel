/** Catálogo de tipos de corrección en lenguaje llano (sin términos internos). */
export type TipoCorreccion = {
  codigo: number;
  nombre: string;
  descripcion: string;
  /** true si la app puede aplicar la corrección por sí misma al aprobarla. */
  automatico: boolean;
};

export const TIPOS_CORRECCION: TipoCorreccion[] = [
  {
    codigo: 1,
    nombre: "Contactos sin actualizar",
    descripcion:
      "Personas con llamadas reales registradas que siguen figurando como no contactadas.",
    automatico: true,
  },
  {
    codigo: 2,
    nombre: "Cuotas sin cargar",
    descripcion: "Edificios con menos de la mitad de los titulares con porcentaje cargado.",
    automatico: false,
  },
  {
    codigo: 4,
    nombre: "Titulares sin tarea",
    descripcion: "Titulares con porcentaje de propiedad y sin ninguna acción prevista.",
    automatico: false,
  },
  {
    codigo: 6,
    nombre: "Seguimientos sin próxima acción",
    descripcion: "Edificios con llamada reciente y sin siguiente paso definido.",
    automatico: false,
  },
];

export function tipoPorCodigo(codigo: number): TipoCorreccion {
  return (
    TIPOS_CORRECCION.find((t) => t.codigo === codigo) ?? {
      codigo,
      nombre: `Tipo ${codigo}`,
      descripcion: "",
      automatico: false,
    }
  );
}

export const ESTADOS_CORRECCION = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  aprobada_pendiente_aplicacion: "Aprobada · pendiente de aplicar",
  aplicada: "Aplicada",
  rechazada: "Rechazada",
} as const;

export type EstadoCorreccion = keyof typeof ESTADOS_CORRECCION;

export function etiquetaEstado(estado: string): string {
  return (ESTADOS_CORRECCION as Record<string, string>)[estado] ?? estado;
}

/** Traduce la propuesta guardada a una frase entendible. */
export function propuestaEnLlano(guarda: number, propuesta: Record<string, unknown> | null): string {
  const p = propuesta ?? {};
  switch (guarda) {
    case 1:
      return `Marcar como «${String(p.valor ?? "Contactado")}» en su estado de contacto.`;
    case 2:
      return `Revisar los porcentajes: ${p.con_cuota ?? "?"} de ${p.total ?? "?"} titulares con porcentaje cargado.`;
    case 4:
      return `Crear una acción de seguimiento para este titular (${p.cuota ?? "?"}% de propiedad).`;
    case 6:
      return "Definir el siguiente paso del edificio.";
    default:
      return "Revisión manual.";
  }
}

/** Enlace interno a la entidad afectada, si se puede construir. */
export function enlaceEntidad(row: {
  guarda: number;
  edificio_id: string | null;
  propuesta: Record<string, unknown> | null;
}): string | null {
  const ownerId = row.propuesta?.owner_id as string | undefined;
  if (row.edificio_id) return `/comercial/edificios/${row.edificio_id}`;
  if (ownerId) return `/propietarios/${ownerId}`;
  return null;
}
