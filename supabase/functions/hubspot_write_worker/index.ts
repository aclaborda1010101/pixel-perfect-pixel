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
  planCamposContacto,
  decidirEnvio,
  estadoAppDeHubspot,
  MAPA_CAMPOS_CONTACTO,
  type AppTask,
} from "../_shared/hubspotWrite/mapping.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function propiedadesContacto(): Promise<string[]> {
  const res = await hubspotFetch("/crm/v3/properties/contacts");
  return (res?.results ?? []).map((p: any) => String(p.name));
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
async function construirCarga(sb: any, fila: any) {
  if (fila.objeto !== "task") return { props: null as Record<string, string> | null, extra: {} as Record<string, unknown> };
  const { data: t } = await sb.from("building_tasks")
    .select("id,building_id,user_id,task_type,task_key,title,description,objetivo,pasos_registro,status,priority,due_date,completed_at")
    .eq("id", fila.entidad_id).maybeSingle();
  if (!t) return { props: null, extra: { motivo: "tarea_inexistente" } };

  // Responsable en HubSpot a partir del correo del comercial.
  let ownerId: string | null = null;
  const { data: perfil } = await sb.from("profiles").select("email").eq("id", t.user_id).maybeSingle();
  if (perfil?.email) {
    const { data: hsOwner } = await sb.from("hubspot_owners").select("hs_owner_id")
      .ilike("email", perfil.email).maybeSingle();
    ownerId = hsOwner?.hs_owner_id ? String(hsOwner.hs_owner_id) : null;
  }
  const props = propiedadesTareaHubspot(t as AppTask, { hubspotOwnerId: ownerId });
  const dealId = t.building_id ? await externalId(sb, "building", t.building_id, "deal") : undefined;
  return { props, extra: { dealId, taskId: t.id } };
}

async function drain(sb: any, activado: boolean, limite: number) {
  const { data: filas } = await sb.from("hubspot_write_queue")
    .select("*").in("estado", ["pendiente", "error"]).order("created_at").limit(limite);
  const resultado = { procesadas: 0, simuladas: 0, enviadas: 0, errores: 0, descartadas: 0, muestras: [] as unknown[] };

  for (const fila of filas ?? []) {
    resultado.procesadas++;
    try {
      const { props, extra } = await construirCarga(sb, fila);
      const decision = decidirEnvio({ activado, payload: props });

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
          estado: "simulado", payload: { ...fila.payload, propiedades: props, deal_id: (extra as any).dealId ?? null },
          processed_at: new Date().toISOString(), last_error: null,
        }).eq("id", fila.id);
        continue;
      }

      // ENVÍO REAL (sólo con el interruptor encendido).
      const existente = await externalId(sb, "building_task", String(fila.entidad_id), "task");
      let hsId = existente;
      if (hsId) {
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
  const existentes = await propiedadesContacto();
  const ejemplo = {
    situacion_comercial: "posible_interes", interlocutor: true, es_influencer: true,
    participacion: 50, consentimiento_whatsapp: true, ultima_llamada: new Date().toISOString(),
    proxima_accion: "llamada", tipologia: "heredero",
  };
  const plan = planCamposContacto(ejemplo, existentes);
  const { count } = await sb.from("hubspot_write_queue")
    .select("id", { count: "exact", head: true }).in("estado", ["pendiente", "error"]);
  return {
    campos_app: Object.values(MAPA_CAMPOS_CONTACTO),
    campos_disponibles: Object.keys(plan.escribibles),
    campos_faltantes: plan.faltantes,
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
      const t = await hubspotFetch(`/crm/v3/objects/tasks/${e.provider_id}?properties=hs_task_status`);
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
    if (!esServicio) {
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

    const { data: activadoRpc } = await sb.rpc("hubspot_escritura_activada");
    const activado = activadoRpc === true;

    if (accion === "audit") return json(200, { ok: true, activado, ...(await audit(sb)) });
    if (accion === "pull") {
      if (!activado) return json(200, { ok: true, activado, skipped: "interruptor_apagado" });
      return json(200, { ok: true, activado, ...(await pull(sb, limite)) });
    }
    if (accion !== "drain") return json(400, { ok: false, error: "accion_desconocida" });
    return json(200, { ok: true, activado, ...(await drain(sb, activado, limite)) });
  } catch (e) {
    return json(500, { ok: false, error: (e as Error)?.message ?? String(e) });
  }
});
