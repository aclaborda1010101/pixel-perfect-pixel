// wa_sync_hubspot — vuelca a HubSpot el estado cualitativo de una conversación
// de WhatsApp: crea/actualiza una nota engagement en el contacto del propietario
// con el resumen + qualification + flags, y mueve hs_lead_status según stage.
// Idempotente: el id de la nota se guarda en external_ids
// (entity_type='wa_conversation', provider_object_type='note').
//
// Read-only fallback: si no hay contact_id de HubSpot resoluble vía
// owners → external_ids, devuelve { ok:false, reason:'no_hs_contact' } sin error.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, hubspotFetch } from "../_shared/hubspot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// stage Afflux → hs_lead_status (valores estándar HubSpot)
const STAGE_TO_HS_STATUS: Record<string, string> = {
  nuevo: "NEW",
  conversando: "OPEN",
  cualificado: "IN_PROGRESS",
  caliente: "CONNECTED",
  handoff: "CONNECTED",
  frio: "UNQUALIFIED",
  cerrado: "BAD_TIMING",
};

function renderNoteBody(args: {
  contactName: string | null;
  phone: string | null;
  stage: string | null;
  rol: string | null;
  subrol: string | null;
  summary: string | null;
  qualification: Record<string, any>;
}) {
  const q = args.qualification || {};
  const flags: string[] = Array.isArray(q.oportunidad_flags) ? q.oportunidad_flags : [];
  const lines: string[] = [];
  lines.push(`<b>Afflux · WhatsApp · ${args.contactName ?? args.phone ?? "(sin nombre)"}</b>`);
  lines.push(`Stage: <b>${args.stage ?? "—"}</b>${args.rol ? ` · Rol: <b>${args.rol}</b>` : ""}${args.subrol && args.subrol !== "ninguno" ? ` (${args.subrol})` : ""}`);
  if (flags.length) lines.push(`Flags oportunidad: <b>${flags.join(", ")}</b>`);
  lines.push("");
  if (args.summary) { lines.push("<b>Resumen</b>"); lines.push(args.summary); lines.push(""); }
  lines.push("<b>Cualificación</b>");
  const order = [
    "tipologia_proindivisario","fase_actual","cuota_participacion","decide_solo",
    "num_copropietarios","dinamica_decision","nivel_conflicto","motivacion_principal",
    "urgencia","estado_edificio","renta_mensual_estimada","gestion_rentas",
    "cobertura_edificio","interes_reunion",
  ];
  for (const k of order) {
    const v = q[k];
    if (v == null || v === "") continue;
    lines.push(`· ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  lines.push("");
  lines.push(`<i>Sincronizado automáticamente desde Afflux · ${new Date().toISOString()}</i>`);
  return lines.join("<br>");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) throw new Error("conversation_id requerido");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: conv, error: convErr } = await admin
      .from("wa_conversations")
      .select("id, summary, qualification, rol_owner, subrol_owner, contact_id, wa_contacts(id, lead_id, name, phone, stage)")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) throw new Error("conversación no encontrada");
    const contact: any = (conv as any).wa_contacts;
    if (!contact) return new Response(JSON.stringify({ ok: false, reason: "no_contact" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    // Resolver hubspot contact id vía owners → external_ids.
    let hsContactId: string | null = null;
    if (contact.lead_id) {
      const { data: ext } = await admin.from("external_ids")
        .select("provider_id")
        .eq("entity_type", "owner").eq("entity_id", contact.lead_id)
        .eq("provider", "hubspot").eq("provider_object_type", "contact")
        .maybeSingle();
      hsContactId = ext?.provider_id ?? null;
    }
    if (!hsContactId) {
      return new Response(JSON.stringify({ ok: false, reason: "no_hs_contact", lead_id: contact.lead_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = renderNoteBody({
      contactName: contact.name,
      phone: contact.phone,
      stage: contact.stage,
      rol: (conv as any).rol_owner,
      subrol: (conv as any).subrol_owner,
      summary: (conv as any).summary,
      qualification: (conv as any).qualification ?? {},
    });

    // Idempotencia: ¿ya hay nota para esta conversación?
    const { data: noteExt } = await admin.from("external_ids")
      .select("provider_id")
      .eq("entity_type", "wa_conversation").eq("entity_id", conversation_id)
      .eq("provider", "hubspot").eq("provider_object_type", "note")
      .maybeSingle();

    let noteId = noteExt?.provider_id ?? null;
    if (noteId) {
      try {
        await hubspotFetch(`/crm/v3/objects/notes/${noteId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: { hs_note_body: body, hs_timestamp: String(Date.now()) } }),
        });
      } catch (e) {
        console.warn("[wa_sync_hubspot] patch note failed, recreating", (e as any)?.message);
        noteId = null;
      }
    }
    if (!noteId) {
      const created = await hubspotFetch("/crm/v3/objects/notes", {
        method: "POST",
        body: JSON.stringify({ properties: { hs_note_body: body, hs_timestamp: String(Date.now()) } }),
      });
      noteId = created?.id;
      if (noteId) {
        // Asociar nota ↔ contacto (associationTypeId 202 = note→contact).
        await hubspotFetch(`/crm/v4/objects/notes/${noteId}/associations/contacts/${hsContactId}`, {
          method: "PUT",
          body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]),
        }).catch((e) => console.warn("[wa_sync_hubspot] assoc note→contact", e?.message));
        await admin.from("external_ids").upsert({
          entity_type: "wa_conversation", entity_id: conversation_id,
          provider: "hubspot", provider_object_type: "note", provider_id: noteId,
        }, { onConflict: "entity_type,entity_id,provider,provider_object_type" });
      }
    }

    // Actualizar hs_lead_status del contacto (no tocar lifecyclestage; lo gobierna Afflux).
    const hsStatus = STAGE_TO_HS_STATUS[contact.stage ?? ""];
    if (hsStatus) {
      await hubspotFetch(`/crm/v3/objects/contacts/${hsContactId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: { hs_lead_status: hsStatus } }),
      }).catch((e) => console.warn("[wa_sync_hubspot] patch contact status", e?.message));
    }

    return new Response(JSON.stringify({
      ok: true, hs_contact_id: hsContactId, note_id: noteId, hs_lead_status: hsStatus ?? null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[wa_sync_hubspot] error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});