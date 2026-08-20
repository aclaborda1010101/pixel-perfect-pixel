/** Catálogo de tipos de corrección en lenguaje llano (sin términos internos). */
export type TipoCorreccion = {
  codigo: number;
  nombre: string;
  descripcion: string;
  /** true si la app puede aplicar la corrección por sí misma al aprobarla. */
  automatico: boolean;
  /** "datos" = requiere aprobar/rechazar; "trabajo" = informativo, lo sirve el generador. */
  seccion: "datos" | "trabajo";
};

export const TIPOS_CORRECCION: TipoCorreccion[] = [
  {
    codigo: 1,
    nombre: "Contactos sin actualizar",
    descripcion:
      "Personas con llamadas reales registradas que siguen figurando como no contactadas.",
    automatico: true,
    seccion: "datos",
  },
  {
    codigo: 2,
    nombre: "Cuotas sin cargar",
    descripcion: "Edificios con menos de la mitad de los titulares con porcentaje cargado.",
    automatico: false,
    seccion: "datos",
  },
  {
    codigo: 4,
    nombre: "Titulares sin tarea",
    descripcion: "Titulares con porcentaje de propiedad y sin ninguna acción prevista.",
    automatico: false,
    seccion: "trabajo",
  },
  {
    codigo: 6,
    nombre: "Seguimientos sin próxima acción",
    descripcion: "Edificios con llamada reciente y sin siguiente paso definido.",
    automatico: false,
    seccion: "datos",
  },
  {
    codigo: 7,
    nombre: "Titulares sin ficha",
    descripcion:
      "Personas que constan en la nota del Registro y todavía no existen como contacto en el sistema.",
    automatico: false,
    seccion: "datos",
  },
  {
    codigo: 8,
    nombre: "Nombres con varias personas",
    descripcion:
      "Titulares cuyo nombre parece contener más de una persona. Se revisan a mano, nunca se separan solos.",
    automatico: false,
    seccion: "datos",
  },
  {
    codigo: 9,
    nombre: "Coincidencias dudosas",
    descripcion:
      "Titulares de la nota que se parecen a varios contactos del edificio y no se pueden enlazar sin confirmación.",
    automatico: false,
    seccion: "datos",
  },
];

/** Tipos que sí son errores de datos y cuentan para el contador principal. */
export const TIPOS_DATOS = TIPOS_CORRECCION.filter((t) => t.seccion === "datos");
/** Tipos que son trabajo comercial pendiente (informativo, sin aprobar/rechazar). */
export const TIPOS_TRABAJO = TIPOS_CORRECCION.filter((t) => t.seccion === "trabajo");

export function esCorreccionDeDatos(codigo: number): boolean {
  return TIPOS_DATOS.some((t) => t.codigo === codigo);
}

export function tipoPorCodigo(codigo: number): TipoCorreccion {
  return (
    TIPOS_CORRECCION.find((t) => t.codigo === codigo) ?? {
      codigo,
      nombre: `Tipo ${codigo}`,
      descripcion: "",
      automatico: false,
      seccion: "datos",
    }
  );
}

export const ESTADOS_CORRECCION = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  aprobada_pendiente_aplicacion: "Aprobada · pendiente de aplicar",
  aplicada: "Aplicada",
  rechazada: "Rechazada",
  obsoleta: "Archivada · ya no aplica",
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
    case 7:
      return `Dar de alta a «${String(p.nombre ?? "titular")}» como contacto${
        p.porcentaje != null ? ` (${p.porcentaje}% de propiedad)` : ""
      }.`;
    case 8:
      return `Revisar a mano el nombre «${String(p.nombre ?? "")}»: puede contener varias personas.`;
    case 9:
      return "Confirmar a mano con qué contacto se corresponde este titular.";
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
