// enrichment-write-hubspot — paso 6 de la skill titulares-edificio-hubspot.
// Tras verificación aprobada, escribe en HubSpot:
//  - empresa (companies) si es jurídica, contacto (contacts) si es persona
//  - asocia al deal del edificio
//  - adjunta nota simple como engagement nota
//  - crea tarea Tecnofind si falta teléfono
// Dedupe por NIF/CIF vía external_ids.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, hubspotFetch } from "../_shared/hubspot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function upsertExternalId(
  supabase: any, entityType: string, entityId: string,
  objectType: string, providerId: string,
) {
  await supabase.from("external_ids").upsert({
    entity_type: entityType, entity_id: entityId,
    provider: "hubspot", provider_object_type: objectType,
    provider_id: providerId,
  }, { onConflict: "entity_type,entity_id,provider,provider_object_type" });
}

async function getExternalId(
  supabase: any, entityType: string, entityId: string, objectType: string,
) {
  const { data } = await supabase.from("external_ids").select("provider_id")
    .eq("entity_type", entityType).eq("entity_id", entityId)
    .eq("provider", "hubspot").eq("provider_object_type", objectType).maybeSingle();
  return data?.provider_id as string | undefined;
}

async function findHubspotByDomain(query: string, prop: string, objectPath: string) {
  try {
    const body = {
      filterGroups: [{ filters: [{ propertyName: prop, operator: "EQ", value: query }] }],
      properties: [prop], limit: 1,
    };
    const res = await hubspotFetch(`/crm/v3/objects/${objectPath}/search`, {
      method: "POST", body: JSON.stringify(body),
    });
    return res?.results?.[0]?.id as string | undefined;
  } catch { return undefined; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { job_id } = await req.json();
    if (!job_id) throw new Error("job_id requerido");

    const { data: job } = await supabase.from("enrichment_jobs")
      .select("*").eq("id", job_id).maybeSingle();
    if (!job) throw new Error("job no encontrado");

    const payload = job.datos?.aplicado_payload ?? job.datos ?? {};
    const nombre = (payload.nombre ?? job.titular_nombre ?? "").trim();
    const nif = (payload.nif ?? job.titular_nif ?? "").trim();
    const tipo = job.titular_tipo as "persona" | "empresa";
    const buildingId = job.building_id;

    // Buscar deal asociado al edificio
    let dealId: string | undefined;
    if (buildingId) {
      dealId = await getExternalId(supabase, "building", buildingId, "deal");
    }

    const result: any = { dealId };

    if (tipo === "empresa") {
      // dedupe por CIF en external_ids → owner local → hubspot company
      let companyId: string | undefined;
      const ownerId = payload.owner_id;
      if (ownerId) companyId = await getExternalId(supabase, "owner", ownerId, "company");
      if (!companyId && nif) companyId = await findHubspotByDomain(nif, "cif_nif", "companies");
      if (!companyId) {
        const create = await hubspotFetch("/crm/v3/objects/companies", {
          method: "POST", body: JSON.stringify({ properties: {
            name: nombre, cif_nif: nif || undefined,
            domicilio_social: payload.domicilio ?? undefined,
          } }),
        });
        companyId = create?.id;
      }
      if (companyId && ownerId) await upsertExternalId(supabase, "owner", ownerId, "company", companyId);
      if (companyId && dealId) {
        await hubspotFetch(`/crm/v4/objects/deals/${dealId}/associations/companies/${companyId}`, {
          method: "PUT", body: JSON.stringify([
            { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 5 },
          ]),
        }).catch(() => {});
      }
      result.companyId = companyId;
    } else {
      let contactId: string | undefined;
      const ownerId = payload.owner_id;
      if (ownerId) contactId = await getExternalId(supabase, "owner", ownerId, "contact");
      if (!contactId && nif) contactId = await findHubspotByDomain(nif, "dni__nif__cif", "contacts");
      if (!contactId) {
        const [firstname, ...rest] = nombre.split(/\s+/);
        const create = await hubspotFetch("/crm/v3/objects/contacts", {
          method: "POST", body: JSON.stringify({ properties: {
            firstname, lastname: rest.join(" ") || undefined,
            dni__nif__cif: nif || undefined,
            tipologia_de_propietario: payload.tipologia ?? undefined,
          } }),
        });
        contactId = create?.id;
      }
      if (contactId && ownerId) await upsertExternalId(supabase, "owner", ownerId, "contact", contactId);
      if (contactId && dealId) {
        await hubspotFetch(`/crm/v4/objects/deals/${dealId}/associations/contacts/${contactId}`, {
          method: "PUT", body: JSON.stringify([
            { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 },
          ]),
        }).catch(() => {});
      }
      result.contactId = contactId;
    }

    // Tarea Tecnofind si falta teléfono
    if (!payload.telefono && dealId) {
      try {
        const due = Date.now() + 24 * 3600 * 1000;
        const taskCreate = await hubspotFetch("/crm/v3/objects/tasks", {
          method: "POST", body: JSON.stringify({ properties: {
            hs_task_subject: `Buscar teléfono Tecnofind — ${nombre}`,
            hs_task_body: `Job ${job_id} · titular ${nombre}${nif ? ` (${nif})` : ""}`,
            hs_task_status: "NOT_STARTED",
            hs_task_priority: "MEDIUM",
            hs_task_type: "TODO",
            hs_timestamp: String(due),
          } }),
        });
        const taskId = taskCreate?.id;
        if (taskId) {
          await hubspotFetch(`/crm/v4/objects/tasks/${taskId}/associations/deals/${dealId}`, {
            method: "PUT", body: JSON.stringify([
              { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 216 },
            ]),
          }).catch(() => {});
          result.tecnofindTaskId = taskId;
        }
      } catch (e) { console.warn("tecnofind task", (e as any).message); }
    }

    // Adjuntar nota simple como engagement nota
    if (job.nota_simple_id && dealId) {
      try {
        const noteCreate = await hubspotFetch("/crm/v3/objects/notes", {
          method: "POST", body: JSON.stringify({ properties: {
            hs_note_body: `Nota simple procesada para ${nombre}. Job enriquecimiento ${job_id}.`,
            hs_timestamp: String(Date.now()),
          } }),
        });
        const noteId = noteCreate?.id;
        if (noteId) {
          await hubspotFetch(`/crm/v4/objects/notes/${noteId}/associations/deals/${dealId}`, {
            method: "PUT", body: JSON.stringify([
              { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 },
            ]),
          }).catch(() => {});
          result.noteId = noteId;
        }
      } catch (e) { console.warn("attach note", (e as any).message); }
    }

    await supabase.from("enrichment_jobs").update({
      estado: "ok", fase: "hubspot",
      datos: { ...job.datos, hubspot: result },
    }).eq("id", job_id);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});