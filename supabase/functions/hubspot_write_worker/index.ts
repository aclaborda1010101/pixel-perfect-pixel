// hubspot_write_worker — ESCRITURA HACIA HUBSPOT (detrás del interruptor).
//
// Acciones:
//   drain  → procesa la cola. Si el interruptor está APAGADO, sólo simula
//            (calcula la carga real y la marca como 'simulado'). NUNCA escribe.
//   audit  → comprueba qué campos comerciales existen en el portal.
//   pull   → trae de HubSpot los cambios de estado de las tareas ya enlazadas.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, hubspotFetch } from "../_shared/hubspot.ts";
import {
  propiedadesTareaHubspot,
  esTareaDeLaApp,
  planCamposContacto,
  decidirEnvio,
  estadoAppDeHubspot,
  MAPA_CAMPOS_CONTACTO,
  prioridadOriginacion,
  piezaDecisoria,
  codigoTipologia,
  etiquetaTipologiaPortal,
  responsableHubspot,
  type OpcionesPortal,
  type AppTask,
} from "../_shared/hubspotWrite/mapping.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Propiedades del contacto en el portal, con sus opciones válidas. */
async function propiedadesContacto(): Promise<{ nombres: string[]; opciones: OpcionesPortal }> {
  const res = await hubspotFetch("/crm/v3/properties/contacts");
  const nombres: string[] = [];
  const opciones: OpcionesPortal = {};
  for (const p of res?.results ?? []) {
    const nombre = String(p.name);
    nombres.push(nombre);
    const ops = (p.options ?? []).map((o: any) => String(o.label));
    if (ops.length > 0) opciones[nombre] = ops;
  }
  return { nombres, opciones };
}

async function externalId(sb: any, entityType: string, entityId: string, objectType: string) {
  const { data } = await sb.from("external_ids").select("provider_id")
    .eq("entity_type", entityType).eq("entity_id", entityId)
    .eq("provider", "hubspot").eq("provider_object_type", objectType).maybeSingle();
  return data?.provider_id as string | undefined;
}

async function saveExternalId(sb: any, entityType: string, entityId: string, objectType: string, providerId: string) {
  await sb.from("external_ids").upsert({
    entity_type: entityType, entity_id: entityId, provider: "hubspot",
    provider_object_type: objectType, provider_id: providerId,
  }, { onConflict: "entity_type,entity_id,provider,provider_object_type" });
}

/** Construye la carga real de una fila de la cola (sin enviarla). */
async function mapaResponsables(sb: any): Promise<Record<string, unknown>> {
  const { data } = await sb.from("app_settings").select("value").eq("key", "hubspot_owner_map").maybeSingle();
  const v = data?.value;
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/** Deja constancia visible de una tarea que sale sin responsable. */
async function avisoSinResponsable(sb: any, email: string | null, tareaId: string) {
  const clave = `hubspot_tarea_sin_responsable:${email ?? "sin_correo"}`;
  await sb.from("integrity_alert_log").upsert({
    issue_key: clave,
    detalle: `La tarea ${tareaId} se ha enviado a HubSpot sin responsable: el comercial ${email ?? "(sin correo)"} no está en el mapa de responsables de HubSpot.`,
    last_sent_at: new Date().toISOString(),
    resolved_at: null,
  }, { onConflict: "issue_key" });
}

async function construirCarga(sb: any, fila: any, mapa: Record<string, unknown> = {}) {
  if (fila.objeto === "contact") return await construirCargaContacto(sb, fila);
  if (fila.objeto !== "task") return { props: null as Record<string, string> | null, extra: {} as Record<string, unknown> };
  const { data: t } = await sb.from("building_tasks")
    .select("id,building_id,user_id,task_type,task_key,title,description,objetivo,pasos_registro,status,priority,due_date,completed_at")
    .eq("id", fila.entidad_id).maybeSingle();
  if (!t) return { props: null, extra: { motivo: "tarea_inexistente" } };

  // Responsable en HubSpot a partir del correo del comercial: primero el mapa
  // canónico (ajuste de aplicación), luego los propietarios sincronizados.
  const { data: perfil } = await sb.from("profiles").select("email").eq("id", t.user_id).maybeSingle();
  const email = perfil?.email ? String(perfil.email).trim().toLowerCase() : null;
  let ownerId = responsableHubspot(email, mapa);
  if (!ownerId && email) {
    const { data: hsOwner } = await sb.from("hubspot_owners").select("hs_owner_id")
      .ilike("email", email).maybeSingle();
    ownerId = hsOwner?.hs_owner_id ? String(hsOwner.hs_owner_id) : null;
  }
  const props = propiedadesTareaHubspot(t as AppTask, { hubspotOwnerId: ownerId });
  const dealId = t.building_id ? await externalId(sb, "building", t.building_id, "deal") : undefined;
  // Propietario destinatario: va incrustado en la clave de la tarea
  // (v5:genN:TIPO:<edificio>:<propietario>:<sello>).
  const partes = String(t.task_key ?? "").split(":");
  const ownerUuid = partes.length >= 5 && /^[0-9a-f-]{36}$/i.test(partes[4]) ? partes[4] : null;
  const contactId = ownerUuid ? await externalId(sb, "owner", ownerUuid, "contact") : undefined;
  return { props, extra: { dealId, contactId, taskId: t.id, sinResponsable: !ownerId, email } };
}

/** Campos comerciales del propietario → propiedades del contacto. */
async function construirCargaContacto(sb: any, fila: any) {
  const ownerId = String(fila.entidad_id);
  let buildingId = (fila.payload ?? {}).building_id ?? null;
  const { data: owner } = await sb.from("owners")
    .select("id,nombre,telefono,consentimiento,subrole,rol,buyer_persona,estado_vital,metadatos")
    .eq("id", ownerId).maybeSingle();
  if (!owner) return { props: null, extra: { motivo: "propietario_inexistente" } };

  if (!buildingId) {
    const { data: bo0 } = await sb.from("building_owners")
      .select("building_id").eq("owner_id", ownerId).limit(1).maybeSingle();
    buildingId = bo0?.building_id ?? null;
  }

  let situacion: string | null = null;
  let esInterlocutor = false;
  let hayInterlocutor = false;
  let marcadoPorSistema = false;
  let edificioDescartado = false;
  if (buildingId) {
    const { data: b } = await sb.from("buildings")
      .select("estado,interlocutor_owner_id,interlocutor_marcado_por").eq("id", buildingId).maybeSingle();
    situacion = b?.estado ?? null;
    esInterlocutor = b?.interlocutor_owner_id === ownerId;
    hayInterlocutor = !!b?.interlocutor_owner_id;
    marcadoPorSistema = String(b?.interlocutor_marcado_por ?? "").toLowerCase() === "sistema";
    edificioDescartado = String(b?.estado ?? "") === "descartado";
  }
  let participacion: number | null = null;
  let influencer = false;
  let tieneFilaEdificio = false;
  if (buildingId) {
    const { data: bo } = await sb.from("building_owners")
      .select("cuota,es_influencer").eq("building_id", buildingId).eq("owner_id", ownerId).maybeSingle();
    participacion = bo?.cuota ?? null;
    influencer = bo?.es_influencer === true;
    tieneFilaEdificio = !!bo;
  }
  const { data: ultima } = await sb.from("calls")
    .select("fecha").eq("owner_id", ownerId).order("fecha", { ascending: false }).limit(1).maybeSingle();

  const { nombres: existentes, opciones } = await propiedadesContacto();
  const meta = (owner.metadatos ?? {}) as Record<string, unknown>;
  const telefono = String(owner.telefono ?? meta.phone ?? "").trim();
  const sinDerecho = tieneFilaEdificio && (participacion === null || Number(participacion) <= 0) && !influencer;

  const prioridad = prioridadOriginacion({
    campanaJunio: !!meta.prioridad_originacion || !!meta.revista_campana,
    participacionRelevante: Number(participacion ?? 0) >= 25,
    sinTelefono: telefono === "",
    edificioDescartado,
    sinDerechoEnNota: sinDerecho,
    contactable: telefono !== "",
  });
  const pieza = piezaDecisoria({ hayInterlocutor, esInterlocutor, marcadoPorSistema });
  const tipologia = etiquetaTipologiaPortal(
    codigoTipologia({
      buyerPersona: owner.buyer_persona,
      esInfluencer: influencer,
      fallecido: String(owner.estado_vital ?? "") === "fallecido",
    }),
    opciones["tipologia_de_propietario"],
  );

  const plan = planCamposContacto({
    situacion_comercial: situacion,
    interlocutor: esInterlocutor,
    es_influencer: influencer,
    participacion,
    consentimiento_whatsapp: owner.consentimiento ?? null,
    ultima_llamada: ultima?.fecha ?? null,
    tipologia,
    prioridad_originacion: prioridad,
    pieza_decisoria: pieza,
    predisposicion: (meta.predisposicion_a_vender as string) ?? null,
    quien_bloquea: (meta.quien_o_que_bloquea as string) ?? null,
  }, existentes, opciones);

  const contactId = await externalId(sb, "owner", ownerId, "contact");
  return {
    props: Object.keys(plan.escribibles).length > 0 ? plan.escribibles : null,
    extra: { contactId, faltantes: plan.faltantes, rechazados: plan.rechazados, building_id: buildingId },
  };
}

async function drain(sb: any, activo: (objeto: string) => boolean, limite: number) {
  const { data: filas } = await sb.from("hubspot_write_queue")
    .select("*").in("estado", ["pendiente", "error"]).order("created_at").limit(limite);
  const resultado = {
    procesadas: 0, simuladas: 0, enviadas: 0, errores: 0, descartadas: 0,
    muestras: [] as unknown[], avisos: [] as string[],
  };
  const mapa = await mapaResponsables(sb);

  for (const fila of filas ?? []) {
    resultado.procesadas++;
    try {
      const { props, extra } = await construirCarga(sb, fila, mapa);
      if ((extra as any).sinResponsable) {
        const email = (extra as any).email ?? null;
        const aviso = `Tarea ${fila.entidad_id} sin responsable en HubSpot: el comercial ${email ?? "(sin correo)"} no está en el mapa de responsables.`;
        if (!resultado.avisos.includes(aviso)) resultado.avisos.push(aviso);
        await avisoSinResponsable(sb, email, String(fila.entidad_id));
      }
      const decision = decidirEnvio({ activado: activo(String(fila.objeto)), payload: props });

      if (decision.accion === "descartar") {
        resultado.descartadas++;
        await sb.from("hubspot_write_queue").update({
          estado: "descartado", last_error: decision.motivo, processed_at: new Date().toISOString(),
        }).eq("id", fila.id);
        continue;
      }

      if (decision.accion === "seco") {
        resultado.simuladas++;
        if (resultado.muestras.length < 5) resultado.muestras.push({ tarea: fila.entidad_id, propiedades: props, deal: (extra as any).dealId ?? null });
        await sb.from("hubspot_write_queue").update({
          estado: "simulado",
          payload: {
            ...fila.payload, propiedades: props,
            deal_id: (extra as any).dealId ?? null,
            contact_id: (extra as any).contactId ?? null,
            campos_faltantes: (extra as any).faltantes ?? null,
          },
          processed_at: new Date().toISOString(), last_error: null,
        }).eq("id", fila.id);
        continue;
      }

      // ENVÍO REAL (sólo con el interruptor encendido).
      if (fila.objeto === "contact") {
        const contactId = (extra as any).contactId;
        if (!contactId) throw new Error("el propietario no está enlazado a ningún contacto de HubSpot");
        await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
          method: "PATCH", body: JSON.stringify({ properties: props }),
        });
        resultado.enviadas++;
        await sb.from("hubspot_write_queue").update({
          estado: "enviado", hubspot_id: String(contactId), last_error: null,
          processed_at: new Date().toISOString(),
        }).eq("id", fila.id);
        continue;
      }
      const existente = await externalId(sb, "building_task", String(fila.entidad_id), "task");
      let hsId = existente;
      if (hsId) {
        // Nunca tocamos una tarea que no haya creado la aplicación.
        const actual = await hubspotFetch(`/crm/v3/objects/tasks/${hsId}?properties=hs_task_subject`);
        if (!esTareaDeLaApp(actual?.properties?.hs_task_subject)) {
          throw new Error("la tarea enlazada en HubSpot no lleva la marca de la aplicación: no se toca");
        }
        await hubspotFetch(`/crm/v3/objects/tasks/${hsId}`, {
          method: "PATCH", body: JSON.stringify({ properties: props }),
        });
      } else {
        const creada = await hubspotFetch("/crm/v3/objects/tasks", {
          method: "POST", body: JSON.stringify({ properties: props }),
        });
        hsId = String(creada?.id);
        await saveExternalId(sb, "building_task", String(fila.entidad_id), "task", hsId);
        const dealId = (extra as any).dealId;
        if (dealId) {
          await hubspotFetch(`/crm/v4/objects/tasks/${hsId}/associations/deals/${dealId}`, {
            method: "PUT",
            body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 }]),
          }).catch(() => {});
        }
        const contactId = (extra as any).contactId;
        if (contactId) {
          await hubspotFetch(`/crm/v4/objects/tasks/${hsId}/associations/contacts/${contactId}`, {
            method: "PUT",
            body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 204 }]),
          }).catch(() => {});
        }
      }
      resultado.enviadas++;
      await sb.from("hubspot_write_queue").update({
        estado: "enviado", hubspot_id: hsId, last_error: null,
        processed_at: new Date().toISOString(),
      }).eq("id", fila.id);
    } catch (e) {
      resultado.errores++;
      await sb.from("hubspot_write_queue").update({
        estado: "error", intentos: (fila.intentos ?? 0) + 1,
        last_error: (e as Error)?.message ?? String(e),
      }).eq("id", fila.id);
    }
  }
  return resultado;
}

async function audit(sb: any) {
  const { nombres: existentes, opciones } = await propiedadesContacto();
  const ejemplo = {
    situacion_comercial: "posible_interes", interlocutor: true, es_influencer: true,
    participacion: 50, consentimiento_whatsapp: true, ultima_llamada: new Date().toISOString(),
    proxima_accion: "llamada",
    tipologia: etiquetaTipologiaPortal("T3", opciones["tipologia_de_propietario"]),
    prioridad_originacion: "Alta", pieza_decisoria: "Sí - confirmada",
    predisposicion: "Desconocido", quien_bloquea: "—",
  };
  const plan = planCamposContacto(ejemplo, existentes, opciones);
  const { count } = await sb.from("hubspot_write_queue")
    .select("id", { count: "exact", head: true }).in("estado", ["pendiente", "error"]);
  return {
    campos_app: Object.values(MAPA_CAMPOS_CONTACTO),
    campos_disponibles: Object.keys(plan.escribibles),
    campos_faltantes: plan.faltantes,
    valores_rechazados: plan.rechazados,
    opciones_acuerdo: {
      prioridad_de_originacion: opciones["prioridad_de_originacion"] ?? null,
      pieza_decisoria: opciones["pieza_decisoria"] ?? null,
      predisposicion_a_vender: opciones["predisposicion_a_vender"] ?? null,
      tipologia_de_propietario: opciones["tipologia_de_propietario"] ?? null,
    },
    pendientes: count ?? 0,
  };
}

async function pull(sb: any, limite: number) {
  const { data: enlaces } = await sb.from("external_ids")
    .select("entity_id,provider_id").eq("provider", "hubspot")
    .eq("provider_object_type", "task").eq("entity_type", "building_task").limit(limite);
  let aplicados = 0;
  for (const e of enlaces ?? []) {
    try {
      const t = await hubspotFetch(
        `/crm/v3/objects/tasks/${e.provider_id}?properties=hs_task_status,hs_task_subject`,
      );
      // Sólo leemos tareas nuestras; una ajena nunca altera la aplicación.
      if (!esTareaDeLaApp(t?.properties?.hs_task_subject)) continue;
      const estado = estadoAppDeHubspot(t?.properties?.hs_task_status);
      if (!estado) continue;
      const { data: ok } = await sb.rpc("hubspot_apply_task_status", {
        p_task_id: e.entity_id, p_status: estado,
      });
      if (ok === true) aplicados++;
    } catch { /* se ignora una tarea borrada en HubSpot */ }
  }
  return { revisadas: (enlaces ?? []).length, aplicados };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    const esServicio = token !== "" && token === SERVICE_KEY;
    // Los procesos programados se identifican con un secreto interno guardado
    // en la base de datos (los crons sólo disponen de la clave pública).
    let esCron = false;
    const cronToken = req.headers.get("x-worker-token") ?? "";
    if (!esServicio && cronToken) {
      const { data: esperado } = await sb.from("app_settings")
        .select("value").eq("key", "hubspot_worker_token").maybeSingle();
      const valor = typeof esperado?.value === "string" ? esperado.value : null;
      esCron = !!valor && valor === cronToken;
    }
    if (!esServicio && !esCron) {
      if (!token) return json(401, { ok: false, error: "no_autenticado" });
      const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data, error } = await authed.auth.getClaims(token);
      const uid = data?.claims?.sub;
      if (error || !uid) return json(401, { ok: false, error: "no_autenticado" });
      const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", uid);
      if (!(roles ?? []).some((r: any) => r.role === "admin")) return json(403, { ok: false, error: "solo_admin" });
    }

    let body: Record<string, unknown> = {};
    try { body = (await req.json()) ?? {}; } catch { body = {}; }
    const accion = String(body.accion ?? "drain");
    const limite = Math.min(Number(body.limite ?? 50) || 50, 200);

    // Dos interruptores independientes: tareas y campos de contacto.
    const { data: interruptores } = await sb.rpc("hubspot_interruptores");
    const tareasOn = (interruptores as any)?.tareas === true;
    const contactosOn = (interruptores as any)?.contactos === true;
    const activo = (objeto: string) =>
      objeto === "task" ? tareasOn : objeto === "contact" ? contactosOn : false;
    const activado = { tareas: tareasOn, contactos: contactosOn };

    if (accion === "audit") return json(200, { ok: true, activado, ...(await audit(sb)) });
    if (accion === "preview") {
      // Simulación pura: construye la carga de contactos concretos, sin escribir.
      const ids = Array.isArray(body.owner_ids) ? body.owner_ids.map(String).slice(0, 10) : [];
      const muestras = [];
      for (const id of ids) {
        const { props, extra } = await construirCargaContacto(sb, { entidad_id: id, payload: body.payload ?? {} });
        muestras.push({ owner_id: id, propiedades: props, ...(extra as Record<string, unknown>) });
      }
      return json(200, { ok: true, activado, simulacion: true, muestras });
    }
    if (accion === "pull") {
      if (!tareasOn) return json(200, { ok: true, activado, skipped: "interruptor_tareas_apagado" });
      return json(200, { ok: true, activado, ...(await pull(sb, limite)) });
    }
    if (accion !== "drain") return json(400, { ok: false, error: "accion_desconocida" });
    return json(200, { ok: true, activado, ...(await drain(sb, activo, limite)) });
  } catch (e) {
    return json(500, { ok: false, error: (e as Error)?.message ?? String(e) });
  }
});
