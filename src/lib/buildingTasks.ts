/**
 * LEGACY ENGINE RETIRED.
 *
 * The automatic `building_tasks` generator (task_type='auto') is retired.
 * These functions remain exported ONLY for import compatibility: they are
 * explicit no-ops and must never insert, reopen or complete building_tasks.
 *
 * Operational tasks now come exclusively from the V5 engine (task_key 'v5:...')
 * or from manual creation. See `@/lib/operationalTasks`.
 */

export type TaskKey =
  | "missing_phones"
  | "uncontacted_owners"
  | "missing_emails"
  | "uncatalogued"
  | "verify_catastral"
  | "check_charges"
  | "prepare_briefing"
  | "schedule_visit";

export type Priority = "high" | "medium" | "low";

export const TASK_DEFS: Record<TaskKey, {
  title: string;
  description: string;
  priority: Priority;
  icon:
    | "Phone"
    | "PhoneCall"
    | "Mail"
    | "ClipboardList"
    | "FileSearch"
    | "AlertTriangle"
    | "Brain"
    | "MapPin";
}> = {
  missing_phones: {
    title: "Conseguir teléfonos de propietarios",
    description: "Hay propietarios sin teléfono registrado en este edificio.",
    priority: "high",
    icon: "Phone",
  },
  uncontacted_owners: {
    title: "Contactar propietarios pendientes",
    description: "Quedan propietarios sin ningún contacto registrado.",
    priority: "high",
    icon: "PhoneCall",
  },
  missing_emails: {
    title: "Conseguir emails de propietarios",
    description: "Hay propietarios sin email registrado.",
    priority: "medium",
    icon: "Mail",
  },
  uncatalogued: {
    title: "Catalogar edificio",
    description: "Faltan datos clave (tipo de oportunidad, m² o nº viviendas).",
    priority: "medium",
    icon: "ClipboardList",
  },
  verify_catastral: {
    title: "Verificar datos catastrales",
    description: "Falta referencia catastral o año de construcción.",
    priority: "low",
    icon: "FileSearch",
  },
  check_charges: {
    title: "Revisar cargas y embargos",
    description: "Hay propietarios con cargas o embargos detectados.",
    priority: "high",
    icon: "AlertTriangle",
  },
  prepare_briefing: {
    title: "Preparar briefing IA",
    description: "Edificio en cartera sin briefings/llamadas previas.",
    priority: "medium",
    icon: "Brain",
  },
  schedule_visit: {
    title: "Agendar visita al edificio",
    description: "Más de 30 días en tu cartera sin visita agendada.",
    priority: "low",
    icon: "MapPin",
  },
};

export const TASK_KEYS = Object.keys(TASK_DEFS) as TaskKey[];

/** @deprecated Legacy auto-task engine retired. No-op: performs no DB writes. */
export async function syncBuildingTasks(_buildingId?: string, _userId?: string): Promise<void> {
  return;
}

/** @deprecated Legacy auto-task engine retired. No-op: performs no DB writes. */
export async function syncAssignedBuildingsTasks(_userId?: string): Promise<void> {
  return;
}

export const LEGACY_TASK_ENGINE_RETIRED = true;
