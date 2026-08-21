// wa_consent_revoke — revoca el consentimiento de WhatsApp de un propietario
// en NUESTRA base y en el CRM del cliente, dejando constancia del motivo.
//
// Antes no existía ninguna vía de revocación: una baja no se reflejaba en
// ningún sitio. Esta función es esa vía.
//
// Body: { owner_id: string, motivo: string, escribir_en_hubspot?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const WA_FLAG_CANDIDATES = ["whatsapp_abierto", "whatsapp_ok", "consentimiento_whatsapp"];

async function detectFlagProperty(): Promise<string | null> {
  try {
    const res = await hubspotFetch(`/crm/v3/properties/contacts`);
    const names = new Set<string>((res?.results || []).map((p: any) => String(p.name)));
    for (const c of WA_FLAG_CANDIDATES) if (names.has(c)) return c;
  } catch (e) {
    console.error(`[wa_consent_revoke] properties fetch fail: ${(e as any)?.message ?? e}`);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(SUP, SR);

  try {
    const body = await req.json().catch(() => ({} as any));
    const ownerId = String(body?.owner_id ?? "").trim();
    const motivo = String(body?.motivo ?? "").trim();
    const escribirHs = body?.escribir_en_hubspot !== false;
    if (!ownerId || !motivo) {
      return new Response(JSON.stringify({ ok: false, error: "owner_id y motivo son obligatorios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Autorización: o bien la clave de servicio (procesos internos), o bien un
    // usuario autenticado de la aplicación.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    let actor: string | null = null;
    if (token && token !== SR) {
      const authed = createClient(SUP, ANON, { global: { headers: { Authorization: authHeader } } });
      const { data: u } = await authed.auth.getUser();
      actor = u?.user?.id ?? null;
      if (!actor) {
        return new Response(JSON.stringify({ ok: false, error: "no_autenticado" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const ahora = new Date().toISOString();

    // 1) Señal de rechazo NUEVA: manda la más reciente.
    const { data: senal, error: insErr } = await sb.from("wa_consent_signals").insert({
      owner_id: ownerId,
      hs_call_id: `revocacion:${ownerId}:${ahora}`,
      veredicto: "rechazado",
      cita_textual: null,
      confianza: 1,
      fecha_llamada: ahora,
      detectado_at: ahora,
      fuente: "revocacion_manual",
      origen: "revocacion",
      registrado_por: actor,
      review_reason: motivo,
      review_updated_at: ahora,
      revocado_at: ahora,
      escrito_en_hubspot: false,
    }).select("id").single();
    if (insErr) throw insErr;

    // 2) Las autorizaciones anteriores quedan marcadas como revocadas.
    const { count: revocadas } = await sb.from("wa_consent_signals")
      .update({
        review_status: "revocado",
        review_reason: motivo,
        review_updated_at: ahora,
        revocado_at: ahora,
        revisado_por: actor,
      }, { count: "exact" })
      .eq("owner_id", ownerId)
      .eq("veredicto", "autorizado");

    // 3) Nuestra base: el propietario deja de estar consentido.
    await sb.from("owners").update({ consentimiento: false }).eq("id", ownerId);

    // 4) Incidencia para dejar constancia.
    await sb.from("wa_consent_incidencias").insert({
      owner_id: ownerId,
      signal_id: senal?.id ?? null,
      tipo: "revocacion",
      motivos: ["revocacion_manual"],
      detalle: motivo,
      estado: "resuelta",
      resuelta_por: actor,
      resuelta_at: ahora,
    });

    // 5) CRM del cliente: apagar la marca de WhatsApp.
    let hubspot: any = { intentado: false };
    if (escribirHs) {
      const { data: ext } = await sb.from("external_ids")
        .select("provider_id").eq("entity_type", "owner").eq("provider", "hubspot")
        .eq("entity_id", ownerId).limit(1);
      const contactId = ext?.[0]?.provider_id ? String(ext[0].provider_id) : null;
      const flagProp = contactId ? await detectFlagProperty() : null;
      hubspot = { intentado: true, contact_id: contactId, propiedad: flagProp };
      if (contactId && flagProp) {
        try {
          await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
            method: "PATCH",
            body: JSON.stringify({ properties: { [flagProp]: "No" } }),
          });
          hubspot.ok = true;
          await sb.from("wa_consent_signals").update({ escrito_en_hubspot: true }).eq("id", senal?.id);
        } catch (e: any) {
          hubspot.ok = false;
          hubspot.error = String(e?.message ?? e);
          console.error(`[wa_consent_revoke] hubspot fail ${contactId}: ${hubspot.error}`);
        }
      } else {
        hubspot.ok = false;
        hubspot.error = contactId ? "propiedad_whatsapp_no_encontrada" : "contacto_hubspot_no_encontrado";
      }
    }

    return new Response(JSON.stringify({
      ok: true, owner_id: ownerId, motivo, senal_id: senal?.id,
      autorizaciones_revocadas: revocadas ?? 0, hubspot,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
