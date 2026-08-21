// push_whatsapp_consent — escribe en HubSpot los consentimientos WA autorizados.
// PATCH del contacto con la propiedad de teléfono de WhatsApp y, si existe,
// whatsapp_abierto='Sí'. Idempotente: marca wa_consent_signals.escrito_en_hubspot=true.
// Si un PATCH devuelve 403, se registra el scope pedido y se detiene el lote (el cron sigue
// intentando pero cada invocación se auto-frenará hasta que el scope se conceda).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";
import { validarConsentimiento } from "../_shared/waConsent.ts";

const ENTITY = "push_whatsapp_consent";
const DEFAULT_BATCH = 25;

// Candidatos ordenados por prioridad. Detección dinámica vía /properties/contacts.
const WA_PHONE_CANDIDATES = [
  "hs_whatsapp_phone_number",
  "whatsapp_phone_number",
  "whatsapp",
  "telefono_whatsapp",
  "phone_whatsapp",
];
const WA_FLAG_CANDIDATES = [
  "whatsapp_abierto",
  "whatsapp_ok",
  "consentimiento_whatsapp",
];

async function detectContactProperty(candidates: string[]): Promise<string | null> {
  try {
    const res = await hubspotFetch(`/crm/v3/properties/contacts`);
    const names = new Set<string>((res?.results || []).map((p: any) => String(p.name)));
    for (const c of candidates) if (names.has(c)) return c;
  } catch (e) {
    console.error(`[push_whatsapp_consent] properties fetch fail: ${(e as any)?.message ?? e}`);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const batchSize = Math.max(1, Math.min(100, Number(body.batch ?? DEFAULT_BATCH)));
  const t0 = Date.now();

  // INTERRUPTOR LEGAL: sin él, no entra nada en el CRM del cliente por esta vía.
  // Sólo una aprobación explícita (approved_signal_ids) puede saltarlo.
  const aprobadas: string[] = Array.isArray(body.approved_signal_ids)
    ? body.approved_signal_ids.map(String).filter(Boolean)
    : [];
  const { data: flag } = await sb.from("app_settings")
    .select("value").eq("key", "wa_consent_escritura_automatica").maybeSingle();
  const automaticaActiva = String((flag as any)?.value ?? "false") === "true";
  if (!automaticaActiva && aprobadas.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "escritura_automatica_desactivada",
      message: "La escritura automática del consentimiento de WhatsApp está desactivada. Sólo se escribe con aprobación manual (approved_signal_ids).",
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { batch: batchSize, aprobadas: aprobadas.length } })
    .select("id").single();
  const logId = logRow?.id;

  let updated = 0, skipped = 0, failed = 0, stopped403 = false, scope403: string | null = null;
  const errors: any[] = [];

  try {
    // 0) Detectar propiedades reales
    const phoneProp = await detectContactProperty(WA_PHONE_CANDIDATES);
    const flagProp = await detectContactProperty(WA_FLAG_CANDIDATES);
    if (!phoneProp) throw new Error("No se encontró propiedad de teléfono WhatsApp en HubSpot (candidatos: " + WA_PHONE_CANDIDATES.join(", ") + ")");


    // 1) Señales pendientes
    let q = sb.from("wa_consent_signals")
      .select("id, owner_id, telefono, hs_call_id, fecha_llamada, cita_textual, review_status, origen")
      .eq("veredicto", "autorizado")
      .eq("escrito_en_hubspot", false)
      .not("telefono", "is", null);
    if (aprobadas.length) q = q.in("id", aprobadas);
    const { data: signalsRaw, error: sErr } = await q
      .order("fecha_llamada", { ascending: false })
      .limit(batchSize);
    if (sErr) throw sErr;

    // 1.bis) TODA escritura pasa por el validador legal.
    const signals: any[] = [];
    const rechazadasPorValidacion: any[] = [];
    for (const s of signalsRaw ?? []) {
      if (["pendiente_revision", "revocado"].includes(String((s as any).review_status ?? ""))) {
        rechazadasPorValidacion.push({ id: s.id, motivos: ["en_revision"] });
        continue;
      }
      const { data: owner } = await sb.from("owners").select("telefono").eq("id", s.owner_id).maybeSingle();
      const { data: call } = await sb.from("hubspot_calls")
        .select("hs_call_transcription").eq("hs_id", String(s.hs_call_id)).maybeSingle();
      const v = validarConsentimiento({
        veredicto: "autorizado",
        cita: (s as any).cita_textual,
        transcripcion: (call as any)?.hs_call_transcription ?? null,
        telefonoLlamada: s.telefono,
        telefonoFicha: (owner as any)?.telefono ?? null,
      });
      if (!v.apto_para_escritura) {
        rechazadasPorValidacion.push({ id: s.id, motivos: v.motivos });
        await sb.from("wa_consent_signals").update({
          veredicto: "dudoso",
          review_status: "pendiente_revision",
          review_reason: v.motivos.join(", "),
          review_updated_at: new Date().toISOString(),
          validacion: v as any,
          veto_motivos: v.vetos,
        }).eq("id", s.id);
        continue;
      }
      signals.push(s);
    }

    if (!signals.length) {
      await sb.from("hubspot_sync_log").update({
        finished_at: new Date().toISOString(), status: "ok",
        metadatos: { batch: batchSize, message: "no_candidates", phoneProp, flagProp, rechazadasPorValidacion },
      }).eq("id", logId);
      return new Response(JSON.stringify({ ok: true, message: "no_candidates", phoneProp, flagProp, rechazadasPorValidacion }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }


    // 2) Owner → contactId vía external_ids
    const ownerIds = Array.from(new Set(signals.map((s: any) => s.owner_id).filter(Boolean)));
    const { data: ext } = await sb.from("external_ids")
      .select("entity_id, provider_id")
      .eq("entity_type", "owner").eq("provider", "hubspot")
      .in("entity_id", ownerIds);
    const ownerToContact = new Map<string, string>();
    for (const r of ext || []) if (!ownerToContact.has(String(r.entity_id))) ownerToContact.set(String(r.entity_id), String(r.provider_id));

    // 3) PATCH por contacto
    for (const sig of signals) {
      if (stopped403) break;
      const contactId = ownerToContact.get(String(sig.owner_id));
      if (!contactId) { skipped++; continue; }
      const phone = String(sig.telefono || "").trim();
      if (!phone) { skipped++; continue; }

      const properties: Record<string, string> = { [phoneProp]: phone };
      if (flagProp) properties[flagProp] = "Sí";

      try {
        await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
          method: "PATCH", body: JSON.stringify({ properties }),
        });
        await sb.from("wa_consent_signals").update({ escrito_en_hubspot: true }).eq("id", sig.id);
        updated++;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        failed++;
        errors.push({ signal_id: sig.id, contact_id: contactId, error: msg });
        console.error(`[push_whatsapp_consent] fail contact=${contactId}: ${msg}`);
        if (msg.includes("403") || /MISSING_SCOPES/i.test(msg)) {
          const scopeMatch = msg.match(/"requiredScopes"\s*:\s*\[([^\]]+)\]/) || msg.match(/scopes?:\s*([^"}]+)/i);
          scope403 = scopeMatch ? scopeMatch[1] : msg;
          stopped403 = true;
          break;
        }
      }
    }

    const status = stopped403 ? "error" : "ok";
    await sb.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status,
      records_upserted: updated, records_failed: failed,
      error_message: stopped403 ? `HTTP 403 MISSING_SCOPES — scope pedido: ${scope403}` : null,
      metadatos: { batch: batchSize, updated, skipped, failed, phoneProp, flagProp, stopped403, scope403, errors: errors.slice(0, 20) },
    }).eq("id", logId);

    return new Response(JSON.stringify({
      ok: !stopped403, updated, skipped, failed, phoneProp, flagProp,
      stopped403, scope403, errors: errors.slice(0, 20), elapsed_ms: Date.now() - t0,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[push_whatsapp_consent] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status: "error", error_message: msg,
      records_upserted: updated, records_failed: failed,
    }).eq("id", logId);
    return new Response(JSON.stringify({ ok: false, error: msg, updated, failed }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});