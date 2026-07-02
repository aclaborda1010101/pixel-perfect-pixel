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

// Etiquetas legibles en español para la nota "FICHA LEAD WHATSAPP".
// Se pintan sólo los campos con valor; los vacíos no se muestran (nota compacta).
const FICHA_LABELS: Array<{ key: string; label: string; fmt?: (v: any) => string }> = [
  { key: "nombre_apellidos",         label: "Nombre" },
  { key: "rol_propietario",          label: "Rol" },              // propietario/heredero/representante
  { key: "direccion_inmueble",       label: "Dirección / edificio" },
  { key: "codigo_postal",            label: "CP" },
  { key: "situacion",                label: "Situación" },        // proindiviso/herencia/conflicto
  { key: "intencion_venta",          label: "Intención de venta" },
  { key: "num_copropietarios",       label: "Nº copropietarios" },
  { key: "cuota_participacion",      label: "% propiedad" },
  { key: "cita_propuesta",           label: "Cita propuesta" },
  // Campos operativos ya usados por wa_ai_reply — se pintan si están.
  { key: "gestiona_edificio",        label: "Gestiona el edificio", fmt: siNo },
  { key: "vive_en_edificio",         label: "Vive en el edificio",  fmt: siNo },
  { key: "relacion_copropietarios",  label: "Relación familiar" },
  { key: "tiene_cuadro_rentas",      label: "Cuadro de rentas",     fmt: siNo },
  { key: "urgencia",                 label: "Urgencia" },
  { key: "motivacion_principal",     label: "Motivación" },
  { key: "p1_oferta_previa",         label: "Oferta previa",        fmt: siNo },
  { key: "p2_motivo",                label: "Motivo (P2)" },
];

function siNo(v: any) {
  if (v === true || v === "si" || v === "sí") return "Sí";
  if (v === false || v === "no") return "No";
  return String(v);
}

function pickField(q: Record<string, any>, keys: string[]): any {
  for (const k of keys) {
    const v = q?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

// Deriva un objeto normalizado con los campos "ficha" a partir de la qualification
// del bot (que usa varias claves distintas según iteración del prompt).
function normalizeFicha(q: Record<string, any>, rol_owner?: string | null): Record<string, any> {
  const norm: Record<string, any> = { ...q };
  norm.rol_propietario = pickField(q, ["rol_propietario", "rol", "tipologia_proindivisario"]) ?? rol_owner ?? null;
  norm.direccion_inmueble = pickField(q, ["direccion_inmueble", "direccion", "edificio_mencionado"]);
  norm.situacion = pickField(q, ["situacion", "nivel_conflicto", "fase_actual"]);
  norm.intencion_venta = pickField(q, ["intencion_venta", "interes_reunion", "motivacion_principal"]);
  norm.num_copropietarios = pickField(q, ["num_copropietarios", "numero_propietarios"]);
  norm.cuota_participacion = pickField(q, ["cuota_participacion", "porcentaje_propiedad", "porcentaje_participacion"]);
  norm.cita_propuesta = pickField(q, ["cita_propuesta", "cita", "fecha_cita_propuesta"]);
  return norm;
}

function renderNoteBody(args: {
  contactName: string | null;
  phone: string | null;
  stage: string | null;
  rol: string | null;
  subrol: string | null;
  summary: string | null;
  qualification: Record<string, any>;
}) {
  const q = normalizeFicha(args.qualification || {}, args.rol);
  const flags: string[] = Array.isArray(q.oportunidad_flags) ? q.oportunidad_flags : [];
  const lines: string[] = [];
  lines.push(`<b>📇 FICHA LEAD WHATSAPP</b>`);
  lines.push(`<b>${args.contactName ?? q.nombre_apellidos ?? args.phone ?? "(sin nombre)"}</b> · ${args.phone ?? "—"}`);
  const stageBits: string[] = [];
  if (args.stage) stageBits.push(`Stage: <b>${args.stage}</b>`);
  if (args.rol) stageBits.push(`Rol interno: <b>${args.rol}</b>${args.subrol && args.subrol !== "ninguno" ? ` (${args.subrol})` : ""}`);
  if (stageBits.length) lines.push(stageBits.join(" · "));
  if (flags.length) lines.push(`Flags: <b>${flags.join(", ")}</b>`);
  lines.push("");
  lines.push("<b>Datos capturados</b>");
  let painted = 0;
  for (const { key, label, fmt } of FICHA_LABELS) {
    const v = q[key];
    if (v == null || v === "") continue;
    const val = fmt ? fmt(v) : (typeof v === "object" ? JSON.stringify(v) : String(v));
    lines.push(`· <b>${label}:</b> ${val}`);
    painted++;
  }
  if (!painted) lines.push("<i>Sin datos capturados todavía.</i>");
  lines.push("");
  if (args.summary) { lines.push("<b>Resumen conversación</b>"); lines.push(args.summary); lines.push(""); }
  lines.push(`<i>Sincronizado desde Afflux · ${new Date().toLocaleString("es-ES")}</i>`);
  return lines.join("<br>");
}

// Inserta / actualiza fila en hubspot_sync_log para trazabilidad.
async function logStart(admin: any, conversation_id: string): Promise<string | null> {
  try {
    const { data } = await admin.from("hubspot_sync_log").insert({
      entity: "wa_ficha",
      status: "running",
      payload: { conversation_id },
    }).select("id").single();
    return data?.id ?? null;
  } catch (_e) { return null; }
}
async function logFinish(admin: any, logId: string | null, status: string, extra: Record<string, any>) {
  if (!logId) return;
  try {
    await admin.from("hubspot_sync_log").update({
      status,
      finished_at: new Date().toISOString(),
      ...extra,
    }).eq("id", logId);
  } catch (_e) { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let admin: any = null;
  let logId: string | null = null;
  let conversation_id: string | null = null;
  try {
    ({ conversation_id } = await req.json());
    if (!conversation_id) throw new Error("conversation_id requerido");
    admin = createClient(SUPABASE_URL, SERVICE_KEY);
    logId = await logStart(admin, conversation_id);

    const { data: conv, error: convErr } = await admin
      .from("wa_conversations")
      .select("id, summary, qualification, rol_owner, subrol_owner, contact_id, wa_contacts(id, lead_id, name, phone, stage)")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convErr) throw convErr;
    if (!conv) throw new Error("conversación no encontrada");
    const contact: any = (conv as any).wa_contacts;
    if (!contact) {
      await logFinish(admin, logId, "skipped", { error: "no_contact" });
      return new Response(JSON.stringify({ ok: false, reason: "no_contact" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Resolver hubspot contact id: primero vía owner mapeado, luego vía wa_contact directo.
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
      const { data: extWa } = await admin.from("external_ids")
        .select("provider_id")
        .eq("entity_type", "wa_contact").eq("entity_id", contact.id)
        .eq("provider", "hubspot").eq("provider_object_type", "contact")
        .maybeSingle();
      hsContactId = extWa?.provider_id ?? null;
    }

    // 2) Si aun así no hay contacto en HubSpot → CREARLO. Cada lead debe quedar registrado.
    const q = (conv as any).qualification ?? {};
    const detectedName: string | null = q.nombre_apellidos || contact.name || null;
    const hsStatus = STAGE_TO_HS_STATUS[contact.stage ?? ""] ?? "NEW";
    let createdContact = false;
    if (!hsContactId) {
      const [firstname, ...rest] = String(detectedName ?? "Lead WhatsApp").trim().split(/\s+/);
      const lastname = rest.join(" ") || null;
      const props: Record<string, string> = {
        firstname: firstname || "Lead WhatsApp",
        phone: contact.phone ?? "",
        lifecyclestage: "lead",
        hs_lead_status: hsStatus,
        fuente: "WhatsApp",
      };
      if (lastname) props.lastname = lastname;
      try {
        const created = await hubspotFetch("/crm/v3/objects/contacts", {
          method: "POST",
          body: JSON.stringify({ properties: props }),
        });
        hsContactId = created?.id ?? null;
        createdContact = !!hsContactId;
      } catch (e: any) {
        // Si HubSpot rechaza por duplicado de teléfono, intentamos buscarlo por phone.
        const msg = String(e?.message ?? "");
        if (msg.includes("CONTACT_EXISTS") || msg.includes("PROPERTY_DOUBLET") || msg.includes("existing")) {
          try {
            const search = await hubspotFetch("/crm/v3/objects/contacts/search", {
              method: "POST",
              body: JSON.stringify({
                filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: contact.phone ?? "" }] }],
                properties: ["phone"], limit: 1,
              }),
            });
            hsContactId = search?.results?.[0]?.id ?? null;
          } catch (_) { /* ignore */ }
        }
        if (!hsContactId) throw e;
      }
      if (hsContactId) {
        await admin.from("external_ids").upsert({
          entity_type: "wa_contact", entity_id: contact.id,
          provider: "hubspot", provider_object_type: "contact", provider_id: hsContactId,
        }, { onConflict: "entity_type,entity_id,provider,provider_object_type" });
      }
    }
    if (!hsContactId) {
      await logFinish(admin, logId, "error", { error: "no_hs_contact_after_create" });
      return new Response(JSON.stringify({ ok: false, reason: "no_hs_contact" }), {
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
      qualification: q,
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
    if (!createdContact && STAGE_TO_HS_STATUS[contact.stage ?? ""]) {
      await hubspotFetch(`/crm/v3/objects/contacts/${hsContactId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: { hs_lead_status: STAGE_TO_HS_STATUS[contact.stage ?? ""] } }),
      }).catch((e) => console.warn("[wa_sync_hubspot] patch contact status", e?.message));
    }

    await logFinish(admin, logId, "ok", {
      payload: { conversation_id, hs_contact_id: hsContactId, note_id: noteId, created_contact: createdContact },
    });
    return new Response(JSON.stringify({
      ok: true, hs_contact_id: hsContactId, note_id: noteId, created_contact: createdContact,
      hs_lead_status: hsStatus ?? null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[wa_sync_hubspot] error", e);
    try {
      if (admin) await logFinish(admin, logId, "error", { error: String(e?.message ?? e).slice(0, 500) });
    } catch (_) { /* ignore */ }
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});