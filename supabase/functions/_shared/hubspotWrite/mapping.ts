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
    hs_task_subject: t.title,
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
};

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
};

/**
 * Reparte los campos comerciales entre los que el portal admite y los que
 * faltan. Nunca crea propiedades: sólo informa de las que no existen.
 */
export function planCamposContacto(
  datos: CamposComercialesEntrada,
  propiedadesExistentes: readonly string[],
): PlanCamposContacto {
  const existentes = new Set(propiedadesExistentes.map((p) => String(p)));
  const escribibles: Record<string, string> = {};
  const faltantes: string[] = [];
  for (const [campo, nombreHs] of Object.entries(MAPA_CAMPOS_CONTACTO)) {
    const valor = valorHubspot((datos as Record<string, unknown>)[campo]);
    if (valor === null) continue;
    if (existentes.has(nombreHs)) escribibles[nombreHs] = valor;
    else if (!faltantes.includes(nombreHs)) faltantes.push(nombreHs);
  }
  return { escribibles, faltantes };
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
