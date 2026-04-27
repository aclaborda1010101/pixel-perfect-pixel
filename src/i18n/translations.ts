export type Locale = "es" | "en";

type Translations = {
  appName: string;
  appTagline: string;
  nav: Record<
    "dashboard" | "owners" | "buildings" | "assets" | "calls" | "investors" | "matching" | "compliance" | "cadences" | "settings",
    string
  >;
  common: Record<
    "search" | "new" | "save" | "cancel" | "edit" | "delete" | "loading" | "empty" | "mock" | "hitl" | "back" | "generate",
    string
  >;
  dashboard: Record<
    "title" | "subtitle" | "kpiOwners" | "kpiCallsWeek" | "kpiPendingMatches" | "kpiComplianceOpen" | "pendingActions" | "recentCalls",
    string
  >;
  owners: Record<"title" | "role" | "consent" | "lastContact", string>;
  settings: Record<
    "language" | "theme" | "themeLight" | "themeDark" | "themeSystem" | "hitlOwner" | "confidenceThreshold",
    string
  >;
  cadences: Record<"mockBanner", string>;
  agents: Record<
    | "preCallTitle"
    | "preCallGenerate"
    | "preCallContext"
    | "preCallObjectives"
    | "preCallQuestions"
    | "preCallRisks"
    | "preCallNextAction"
    | "preCallConfidence"
    | "analyzeNoteTitle"
    | "analyzeNotePlaceholder"
    | "analyzeNoteRun"
    | "analyzeNoteFacts"
    | "analyzeNoteIntents"
    | "analyzeNoteSentiment"
    | "analyzeNoteAction"
    | "analyzeNoteSaveAction"
    | "analyzeNoteReview",
    string
  >;
};

export const translations: Record<Locale, Translations> = {
  es: {
    appName: "AFFLUX",
    appTagline: "CRM operativo de originación inmobiliaria",
    nav: {
      dashboard: "Dashboard",
      owners: "Propietarios",
      buildings: "Edificios",
      assets: "Activos",
      calls: "Llamadas",
      investors: "Inversores",
      matching: "Matching",
      compliance: "Compliance",
      cadences: "Cadencias / WhatsApp",
      settings: "Ajustes",
    },
    common: {
      search: "Buscar",
      new: "Nuevo",
      save: "Guardar",
      cancel: "Cancelar",
      edit: "Editar",
      delete: "Eliminar",
      loading: "Cargando…",
      empty: "Sin datos todavía",
      mock: "Mock",
      hitl: "Requiere revisión humana",
      back: "Volver",
      generate: "Generar",
    },
    dashboard: {
      title: "Resumen operativo",
      subtitle: "Trabajo pendiente y señales en tiempo real",
      kpiOwners: "Propietarios activos",
      kpiCallsWeek: "Llamadas (7 días)",
      kpiPendingMatches: "Candidatos pendientes",
      kpiComplianceOpen: "Casos compliance abiertos",
      pendingActions: "Próximas acciones pendientes",
      recentCalls: "Llamadas recientes",
    },
    owners: {
      title: "Propietarios",
      role: "Rol",
      consent: "Consentimiento",
      lastContact: "Último contacto",
    },
    settings: {
      language: "Idioma",
      theme: "Tema",
      themeLight: "Claro",
      themeDark: "Oscuro",
      themeSystem: "Sistema",
      hitlOwner: "Responsable HITL",
      confidenceThreshold: "Umbral de confianza por defecto",
    },
    cadences: {
      mockBanner:
        "Modo simulación: ningún mensaje real se envía desde AFFLUX en este MVP.",
    },
  },
  en: {
    appName: "AFFLUX",
    appTagline: "Real-estate origination CRM",
    nav: {
      dashboard: "Dashboard",
      owners: "Owners",
      buildings: "Buildings",
      assets: "Assets",
      calls: "Calls",
      investors: "Investors",
      matching: "Matching",
      compliance: "Compliance",
      cadences: "Cadences / WhatsApp",
      settings: "Settings",
    },
    common: {
      search: "Search",
      new: "New",
      save: "Save",
      cancel: "Cancel",
      edit: "Edit",
      delete: "Delete",
      loading: "Loading…",
      empty: "No data yet",
      mock: "Mock",
      hitl: "Human review required",
      back: "Back",
      generate: "Generate",
    },
    dashboard: {
      title: "Operational overview",
      subtitle: "Pending work and live signals",
      kpiOwners: "Active owners",
      kpiCallsWeek: "Calls (7 days)",
      kpiPendingMatches: "Pending candidates",
      kpiComplianceOpen: "Open compliance cases",
      pendingActions: "Pending next actions",
      recentCalls: "Recent calls",
    },
    owners: {
      title: "Owners",
      role: "Role",
      consent: "Consent",
      lastContact: "Last contact",
    },
    settings: {
      language: "Language",
      theme: "Theme",
      themeLight: "Light",
      themeDark: "Dark",
      themeSystem: "System",
      hitlOwner: "HITL owner",
      confidenceThreshold: "Default confidence threshold",
    },
    cadences: {
      mockBanner:
        "Simulation mode: no real message is sent from AFFLUX in this MVP.",
    },
  },
};

export type Dictionary = Translations;