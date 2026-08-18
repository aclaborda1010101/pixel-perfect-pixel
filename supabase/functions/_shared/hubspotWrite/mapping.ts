/**
 * ESCRITURA EN HUBSPOT — lógica pura y portable (sin red, sin BD).
 * La comparten la Edge Function, el frontend y los tests.
 *
 * REGLA DE ORO: nada de esto escribe por sí solo. Construye la carga
 * (payload) y decide si se envía o se queda en seco según el interruptor
 * `app_settings.hubspot_escritura_activada`.
 */

/* --------------------------- TAREAS --------------------------- */

export type AppTaskStatus =
  | "pending" | "in_progress" | "completed" | "blocked"
  | "skipped" | "no_procede" | "cancelled" | "superseded";

export type HubspotTaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "COMPLETED" | "DEFERRED";

const ESTADO_A_HUBSPOT: Record<AppTaskStatus, HubspotTaskStatus> = {
  pending: "NOT_STARTED",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
  blocked: "WAITING",
  skipped: "DEFERRED",
  no_procede: "DEFERRED",
  cancelled: "DEFERRED",
  superseded: "DEFERRED",
};

/** Estado de HubSpot equivalente al de la aplicación (fail-closed). */
export function estadoHubspotDeTarea(status: unknown): HubspotTaskStatus | null {
  const s = String(status ?? "");
  return (ESTADO_A_HUBSPOT as Record<string, HubspotTaskStatus>)[s] ?? null;
}

/** Estado de la aplicación equivalente al de HubSpot (sólo cierres reales). */
export function estadoAppDeHubspot(hsStatus: unknown): AppTaskStatus | null {
  switch (String(hsStatus ?? "").toUpperCase()) {
    case "NOT_STARTED": return "pending";
    case "IN_PROGRESS": return "in_progress";
    case "WAITING": return "blocked";
    case "COMPLETED": return "completed";
    case "DEFERRED": return "skipped";
    default: return null;
  }
}

const PRIORIDAD: Record<string, "LOW" | "MEDIUM" | "HIGH"> = {
  low: "LOW", medium: "MEDIUM", high: "HIGH",
};

/** Tipos de tarea que en HubSpot son una llamada. */
const TIPOS_LLAMADA = new Set(["T-02_03", "T-04"]);

/**
 * Marca que distingue NUESTRAS tareas de las que el cliente ya tenía en HubSpot.
 * Va al principio del asunto para que puedan filtrarlas de un vistazo.
 */
export const MARCA_APP = "[Afflux]";

/** Asunto con la marca de la aplicación, sin duplicarla si ya está. */
export function asuntoTarea(titulo: string): string {
  const t = String(titulo ?? "").trim();
  return t.startsWith(MARCA_APP) ? t : `${MARCA_APP} ${t}`;
}

/** ¿Este asunto corresponde a una tarea creada por la aplicación? */
export function esTareaDeLaApp(asunto: unknown): boolean {
  return String(asunto ?? "").trimStart().startsWith(MARCA_APP);
}

export type AppTask = {
  id: string;
  task_type?: string | null;
  task_key?: string | null;
  title: string;
  description?: string | null;
  objetivo?: string | null;
  pasos_registro?: string | null;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
};

export function cuerpoTarea(t: AppTask): string {
  const partes = [t.description, t.objetivo ? `Objetivo: ${t.objetivo}` : null,
    t.pasos_registro ? `Al terminar: ${t.pasos_registro}` : null]
    .map((p) => (p ?? "").trim()).filter((p) => p.length > 0);
  return partes.join("\n\n");
}

/** Propiedades de la tarea de HubSpot equivalentes a la tarea de la app. */
export function propiedadesTareaHubspot(
  t: AppTask, opts: { hubspotOwnerId?: string | null } = {},
): Record<string, string> {
  const estado = estadoHubspotDeTarea(t.status);
  if (!estado) throw new Error(`estado de tarea no mapeable: ${String(t.status)}`);
  const cuando = t.due_date ?? t.completed_at ?? null;
  const props: Record<string, string> = {
    hs_task_subject: asuntoTarea(t.title),
    hs_task_body: cuerpoTarea(t),
    hs_task_status: estado,
    hs_task_priority: PRIORIDAD[String(t.priority ?? "medium")] ?? "MEDIUM",
    hs_task_type: TIPOS_LLAMADA.has(String(t.task_type ?? "")) ? "CALL" : "TODO",
  };
  if (cuando) props.hs_timestamp = new Date(cuando).toISOString();
  if (opts.hubspotOwnerId) props.hubspot_owner_id = String(opts.hubspotOwnerId);
  return props;
}

/** Clave de deduplicación de la cola: una fila viva por tarea y acción. */
export function claveCola(objeto: string, entidadId: string, accion: string): string {
  return `${objeto}:${entidadId}:${accion}`;
}

/* --------------------- CAMPOS COMERCIALES --------------------- */

export type CamposComercialesEntrada = {
  situacion_comercial?: string | null;
  interlocutor?: boolean | null;
  es_influencer?: boolean | null;
  participacion?: number | null;
  consentimiento_whatsapp?: boolean | null;
  ultima_llamada?: string | null;
  proxima_accion?: string | null;
  tipologia?: string | null;
  /** Campos del acuerdo con el cliente (nombres internos reales del portal). */
  prioridad_originacion?: string | null;
  pieza_decisoria?: string | null;
  predisposicion?: string | null;
  quien_bloquea?: string | null;
};

/** Nombre interno en HubSpot de cada campo comercial de la aplicación. */
export const MAPA_CAMPOS_CONTACTO: Record<keyof CamposComercialesEntrada, string> = {
  situacion_comercial: "situacion_comercial",
  interlocutor: "es_interlocutor",
  es_influencer: "es_influenciador",
  participacion: "porcentaje_de_participacion",
  consentimiento_whatsapp: "consentimiento_whatsapp",
  ultima_llamada: "fecha_ultima_llamada",
  proxima_accion: "proxima_accion_comercial",
  tipologia: "tipologia_de_propietario",
  prioridad_originacion: "prioridad_de_originacion",
  pieza_decisoria: "pieza_decisoria",
  predisposicion: "predisposicion_a_vender",
  quien_bloquea: "quien_o_que_bloquea",
};

/* ------------- CAMPOS DEL ACUERDO: VALORES PERMITIDOS ------------- */

/** Opciones válidas por campo, tal y como están escritas en el portal. */
export type OpcionesPortal = Record<string, readonly string[]>;

export type Prioridad = "Alta" | "Media" | "Baja" | "Investigación previa" | "Excluido";

export type SenalesPrioridad = {
  campanaJunio?: boolean | null;
  participacionRelevante?: boolean | null;
  sinTelefono?: boolean | null;
  edificioDescartado?: boolean | null;
  sinDerechoEnNota?: boolean | null;
  contactable?: boolean | null;
};

/** Prioridad de originación a partir de las señales reales del propietario. */
export function prioridadOriginacion(s: SenalesPrioridad): Prioridad {
  if (s.edificioDescartado === true || s.sinDerechoEnNota === true) return "Excluido";
  if (s.sinTelefono === true) return "Investigación previa";
  if (s.campanaJunio === true || s.participacionRelevante === true) return "Alta";
  return s.contactable === true ? "Media" : "Baja";
}

export type PiezaDecisoria = "Sí - confirmada" | "Propuesta por el sistema" | "No";

/**
 * Pieza decisoria: sólo se rellena cuando el edificio tiene interlocutor
 * evaluado. Sin evaluar → vacío (nunca se inventa un "No").
 */
export function piezaDecisoria(i: {
  hayInterlocutor?: boolean | null;
  esInterlocutor?: boolean | null;
  marcadoPorSistema?: boolean | null;
}): PiezaDecisoria | null {
  if (i.hayInterlocutor !== true) return null;
  if (i.esInterlocutor !== true) return "No";
  return i.marcadoPorSistema === true ? "Propuesta por el sistema" : "Sí - confirmada";
}

const PERSONA_A_CODIGO: Record<string, string> = {
  cansado: "T1",
  desplazado: "T2",
  controla: "T3",
  ego: "T4",
  no_traspasa: "T5",
  vive_edificio: "T6",
  no_primero: "T7",
};

/**
 * Código de tipología del propietario. T8 = influenciador, T10 = fallecido.
 * Sin tipología fiable → null (nunca "T9" por defecto).
 */
export function codigoTipologia(i: {
  buyerPersona?: string | null;
  esInfluencer?: boolean | null;
  fallecido?: boolean | null;
}): string | null {
  if (i.fallecido === true) return "T10";
  const p = String(i.buyerPersona ?? "").trim().toLowerCase();
  const code = PERSONA_A_CODIGO[p];
  if (code) return code;
  if (i.esInfluencer === true) return "T8";
  return null;
}

/** Etiqueta larga exacta del portal para un código T{n} (o null si no existe). */
export function etiquetaTipologiaPortal(
  codigo: string | null | undefined,
  opciones: readonly string[] | undefined,
): string | null {
  const c = String(codigo ?? "").trim().toUpperCase();
  if (!c || !opciones) return null;
  const re = new RegExp(`^${c}(?![0-9])`, "i");
  return opciones.find((o) => re.test(String(o).trim())) ?? null;
}

export type FiltroOpciones = {
  escribibles: Record<string, string>;
  rechazados: { campo: string; valor: string }[];
};

/**
 * Deja sólo los valores que existen como opción en el portal. Un campo sin
 * lista de opciones (texto libre) pasa tal cual. Fail-closed: si el valor no
 * encaja, el campo se queda vacío y se registra.
 */
export function filtrarPorOpciones(
  props: Record<string, string>,
  opciones: OpcionesPortal,
): FiltroOpciones {
  const escribibles: Record<string, string> = {};
  const rechazados: { campo: string; valor: string }[] = [];
  for (const [campo, valor] of Object.entries(props)) {
    const permitidas = opciones[campo];
    if (!permitidas || permitidas.length === 0) { escribibles[campo] = valor; continue; }
    if (permitidas.some((o) => String(o) === valor)) escribibles[campo] = valor;
    else rechazados.push({ campo, valor });
  }
  return { escribibles, rechazados };
}

function valorHubspot(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export type PlanCamposContacto = {
  /** Campos que existen en el portal y se escribirían. */
  escribibles: Record<string, string>;
  /** Campos de la app que HubSpot no tiene: se reportan, no se inventan. */
  faltantes: string[];
  /** Valores que no coinciden con ninguna opción del portal: no se escriben. */
  rechazados: { campo: string; valor: string }[];
};

/**
 * Reparte los campos comerciales entre los que el portal admite y los que
 * faltan. Nunca crea propiedades: sólo informa de las que no existen.
 */
export function planCamposContacto(
  datos: CamposComercialesEntrada,
  propiedadesExistentes: readonly string[],
  opciones: OpcionesPortal = {},
): PlanCamposContacto {
  const existentes = new Set(propiedadesExistentes.map((p) => String(p)));
  const candidatos: Record<string, string> = {};
  const faltantes: string[] = [];
  for (const [campo, nombreHs] of Object.entries(MAPA_CAMPOS_CONTACTO)) {
    const valor = valorHubspot((datos as Record<string, unknown>)[campo]);
    if (valor === null) continue;
    if (existentes.has(nombreHs)) candidatos[nombreHs] = valor;
    else if (!faltantes.includes(nombreHs)) faltantes.push(nombreHs);
  }
  const { escribibles, rechazados } = filtrarPorOpciones(candidatos, opciones);
  return { escribibles, faltantes, rechazados };
}

/* ------------------------ INTERRUPTOR ------------------------ */

export type DecisionEnvio =
  | { accion: "enviar" }
  | { accion: "seco"; motivo: "interruptor_apagado" }
  | { accion: "descartar"; motivo: "sin_cambios" | "sin_payload" };

/** Decide qué hacer con una fila de la cola. Fail-closed: por defecto, seco. */
export function decidirEnvio(input: {
  activado: unknown;
  payload: Record<string, unknown> | null | undefined;
}): DecisionEnvio {
  const p = input.payload;
  if (!p || Object.keys(p).length === 0) return { accion: "descartar", motivo: "sin_payload" };
  if (input.activado !== true) return { accion: "seco", motivo: "interruptor_apagado" };
  return { accion: "enviar" };
}
