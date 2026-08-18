import { describe, it, expect } from "vitest";
import {
  estadoHubspotDeTarea,
  estadoAppDeHubspot,
  propiedadesTareaHubspot,
  cuerpoTarea,
  claveCola,
  planCamposContacto,
  decidirEnvio,
  MAPA_CAMPOS_CONTACTO,
  prioridadOriginacion,
  piezaDecisoria,
  codigoTipologia,
  etiquetaTipologiaPortal,
  filtrarPorOpciones,
} from "../../supabase/functions/_shared/hubspotWrite/mapping.ts";

const tarea = {
  id: "t1",
  task_type: "T-04",
  title: "Llamar a María",
  description: "Qué hacer: llama al propietario.",
  objetivo: "Concertar visita",
  pasos_registro: "Registra el resultado",
  status: "pending",
  priority: "high",
  due_date: "2026-08-20T10:00:00.000Z",
};

describe("estados de tarea", () => {
  it("mapea los estados canónicos", () => {
    expect(estadoHubspotDeTarea("pending")).toBe("NOT_STARTED");
    expect(estadoHubspotDeTarea("in_progress")).toBe("IN_PROGRESS");
    expect(estadoHubspotDeTarea("completed")).toBe("COMPLETED");
    expect(estadoHubspotDeTarea("blocked")).toBe("WAITING");
    expect(estadoHubspotDeTarea("no_procede")).toBe("DEFERRED");
  });
  it("rechaza estados desconocidos (fail-closed)", () => {
    expect(estadoHubspotDeTarea("queued")).toBeNull();
    expect(estadoHubspotDeTarea(null)).toBeNull();
  });
  it("vuelta desde HubSpot", () => {
    expect(estadoAppDeHubspot("COMPLETED")).toBe("completed");
    expect(estadoAppDeHubspot("waiting")).toBe("blocked");
    expect(estadoAppDeHubspot("RARO")).toBeNull();
  });
});

describe("propiedades de la tarea", () => {
  it("construye el payload completo", () => {
    const p = propiedadesTareaHubspot(tarea, { hubspotOwnerId: "77" });
    expect(p.hs_task_subject).toBe("[Afflux] Llamar a María");
    expect(p.hs_task_status).toBe("NOT_STARTED");
    expect(p.hs_task_priority).toBe("HIGH");
    expect(p.hs_task_type).toBe("CALL");
    expect(p.hs_timestamp).toBe("2026-08-20T10:00:00.000Z");
    expect(p.hubspot_owner_id).toBe("77");
  });
  it("tipo TODO cuando no es de contacto telefónico", () => {
    expect(propiedadesTareaHubspot({ ...tarea, task_type: "T-01" }).hs_task_type).toBe("TODO");
  });
  it("lanza con estado no mapeable", () => {
    expect(() => propiedadesTareaHubspot({ ...tarea, status: "queued" })).toThrow();
  });
  it("el cuerpo incluye objetivo y cierre", () => {
    const c = cuerpoTarea(tarea);
    expect(c).toContain("Objetivo: Concertar visita");
    expect(c).toContain("Al terminar: Registra el resultado");
  });
  it("clave de cola estable", () => {
    expect(claveCola("task", "t1", "upsert")).toBe("task:t1:upsert");
  });
});

describe("campos comerciales del contacto", () => {
  const existentes = [
    MAPA_CAMPOS_CONTACTO.tipologia,
    MAPA_CAMPOS_CONTACTO.participacion,
    MAPA_CAMPOS_CONTACTO.situacion_comercial,
  ];
  it("separa escribibles de faltantes", () => {
    const plan = planCamposContacto(
      {
        situacion_comercial: "posible_interes",
        participacion: 33.5,
        tipologia: "heredero",
        es_influencer: true,
        consentimiento_whatsapp: true,
      },
      existentes,
    );
    expect(plan.escribibles).toEqual({
      situacion_comercial: "posible_interes",
      porcentaje_de_participacion: "33.5",
      tipologia_de_propietario: "heredero",
    });
    expect(plan.faltantes).toEqual(["es_influenciador", "consentimiento_whatsapp"]);
  });
  it("ignora valores vacíos", () => {
    const plan = planCamposContacto({ situacion_comercial: null, tipologia: "" }, existentes);
    expect(plan.escribibles).toEqual({});
    expect(plan.faltantes).toEqual([]);
  });
  it("no duplica faltantes", () => {
    const plan = planCamposContacto({ es_influencer: false, interlocutor: true }, []);
    expect(plan.faltantes).toEqual(["es_interlocutor", "es_influenciador"]);
  });
});

describe("campos del acuerdo", () => {
  it("usa los nombres internos reales del portal", () => {
    expect(MAPA_CAMPOS_CONTACTO.prioridad_originacion).toBe("prioridad_de_originacion");
    expect(MAPA_CAMPOS_CONTACTO.pieza_decisoria).toBe("pieza_decisoria");
    expect(MAPA_CAMPOS_CONTACTO.predisposicion).toBe("predisposicion_a_vender");
    expect(MAPA_CAMPOS_CONTACTO.quien_bloquea).toBe("quien_o_que_bloquea");
  });

  it("prioridad de originación", () => {
    expect(prioridadOriginacion({ campanaJunio: true, contactable: true })).toBe("Alta");
    expect(prioridadOriginacion({ participacionRelevante: true, contactable: true })).toBe("Alta");
    expect(prioridadOriginacion({ sinTelefono: true, campanaJunio: true })).toBe("Investigación previa");
    expect(prioridadOriginacion({ edificioDescartado: true, campanaJunio: true })).toBe("Excluido");
    expect(prioridadOriginacion({ sinDerechoEnNota: true, contactable: true })).toBe("Excluido");
    expect(prioridadOriginacion({ contactable: true })).toBe("Media");
    expect(prioridadOriginacion({ contactable: false })).toBe("Baja");
  });

  it("pieza decisoria", () => {
    expect(piezaDecisoria({ hayInterlocutor: true, esInterlocutor: true })).toBe("Sí - confirmada");
    expect(piezaDecisoria({ hayInterlocutor: true, esInterlocutor: true, marcadoPorSistema: true }))
      .toBe("Propuesta por el sistema");
    expect(piezaDecisoria({ hayInterlocutor: true, esInterlocutor: false })).toBe("No");
    expect(piezaDecisoria({ hayInterlocutor: false, esInterlocutor: false })).toBeNull();
  });

  it("tipología: T8 influenciador, T10 fallecido, nunca T9 por defecto", () => {
    expect(codigoTipologia({ buyerPersona: "controla" })).toBe("T3");
    expect(codigoTipologia({ esInfluencer: true })).toBe("T8");
    expect(codigoTipologia({ fallecido: true, buyerPersona: "controla" })).toBe("T10");
    expect(codigoTipologia({ buyerPersona: "sin_clasificar" })).toBeNull();
    expect(codigoTipologia({})).toBeNull();
  });

  it("traduce el código a la etiqueta larga exacta del portal", () => {
    const ops = ["T1: El cansado", "T3: El que controla la situación", "T10: Fallecido"];
    expect(etiquetaTipologiaPortal("T3", ops)).toBe("T3: El que controla la situación");
    expect(etiquetaTipologiaPortal("T1", ops)).toBe("T1: El cansado");
    expect(etiquetaTipologiaPortal("T4", ops)).toBeNull();
    expect(etiquetaTipologiaPortal(null, ops)).toBeNull();
  });

  it("un valor fuera del catálogo del portal no se escribe", () => {
    const r = filtrarPorOpciones(
      { pieza_decisoria: "Si confirmada", prioridad_de_originacion: "Alta", quien_o_que_bloquea: "El hermano" },
      { pieza_decisoria: ["Sí - confirmada", "Propuesta por el sistema", "No"], prioridad_de_originacion: ["Alta", "Media"] },
    );
    expect(r.escribibles).toEqual({ prioridad_de_originacion: "Alta", quien_o_que_bloquea: "El hermano" });
    expect(r.rechazados).toEqual([{ campo: "pieza_decisoria", valor: "Si confirmada" }]);
  });

  it("el plan valida contra las opciones del portal", () => {
    const plan = planCamposContacto(
      { prioridad_originacion: "Urgente", pieza_decisoria: "No" },
      ["prioridad_de_originacion", "pieza_decisoria"],
      { prioridad_de_originacion: ["Alta", "Media", "Baja", "Investigación previa", "Excluido"],
        pieza_decisoria: ["Sí - confirmada", "Propuesta por el sistema", "No"] },
    );
    expect(plan.escribibles).toEqual({ pieza_decisoria: "No" });
    expect(plan.rechazados).toEqual([{ campo: "prioridad_de_originacion", valor: "Urgente" }]);
  });
});

describe("interruptor de escritura", () => {
  it("con el interruptor apagado sólo hay simulación", () => {
    expect(decidirEnvio({ activado: false, payload: { a: 1 } })).toEqual({
      accion: "seco", motivo: "interruptor_apagado",
    });
    expect(decidirEnvio({ activado: "true" as unknown, payload: { a: 1 } }).accion).toBe("seco");
  });
  it("con el interruptor encendido se envía", () => {
    expect(decidirEnvio({ activado: true, payload: { a: 1 } })).toEqual({ accion: "enviar" });
  });
  it("payload vacío se descarta", () => {
    expect(decidirEnvio({ activado: true, payload: {} }).accion).toBe("descartar");
  });
});
