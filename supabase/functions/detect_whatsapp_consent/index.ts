// detect_whatsapp_consent — detecta si el propietario ha AUTORIZADO/RECHAZADO
// que le escribamos por WhatsApp durante una llamada. Recorre hubspot_calls
// con hs_call_transcription no vacía por lotes. Prioriza las que mencionan
// "whats". Escribe en wa_consent_signals (UNIQUE owner_id+hs_call_id).
//
// NO escribe en HubSpot (token de solo lectura). escrito_en_hubspot=false.
//
// Params: { limit?: number (default 30), only_whatsapp?: boolean, hs_call_id?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { validarConsentimiento } from "../_shared/waConsent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const DEFAULT_LIMIT = 30;
const PRIMARY = { name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-5.6-luna" };
const FALLBACK = { name: "lovable", url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3-flash-preview" };

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function buildPrompt(transcript: string): string {
  return `Eres un auditor de llamadas comerciales inmobiliarias en España. Analiza la transcripción y decide EXCLUSIVAMENTE si durante la conversación el comercial (o el sistema) pidió permiso al propietario para escribirle por WhatsApp y cuál fue la respuesta.

Devuelve JSON EXACTO:
{
  "veredicto": "autorizado" | "rechazado" | "no_tratado" | "dudoso",
  "cita_textual": "frase LITERAL de la transcripción que lo pruebe (obligatoria si autorizado/rechazado; si no, cadena vacía)",
  "confianza": 0.0-1.0
}

REGLAS:
- "autorizado" solo si el propietario acepta expresamente ("sí, mándamelo por WhatsApp", "vale, escríbeme", "perfecto, por WhatsApp mejor"). No basta que el comercial diga que lo hará.
- "rechazado" si el propietario dice no explícitamente ("no me escribas", "no uso WhatsApp", "prefiero email/llamada").
- "no_tratado" si en la llamada NO se menciona WhatsApp/WhatsApp/whatsapp o similares.
- "dudoso" si se menciona pero la respuesta no es clara (silencio, cambio de tema).
- La cita_textual debe ser una frase real presente en la transcripción, sin inventar.
- Devuelve confianza baja (<0.6) si tienes dudas.

TRANSCRIPCIÓN:
"""
${stripHtml(transcript).slice(0, 18000)}
"""`;
}

async function callLLM(prompt: string): Promise<{ veredicto: string; cita_textual: string; confianza: number } | null> {
  const OR = Deno.env.get("OPENROUTER_API_KEY") || "";
  const LK = Deno.env.get("LOVABLE_API_KEY") || "";
  const providers = [
    OR ? { ...PRIMARY, auth: `Bearer ${OR}`, extra: { "HTTP-Referer": "https://affluxosv2.world", "X-Title": "Afflux OS · WhatsApp Consent" } } : null,
    LK ? { ...FALLBACK, auth: `Bearer ${LK}`, extra: {} as Record<string, string> } : null,
  ].filter(Boolean) as any[];

  for (const p of providers) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: p.auth, "Content-Type": "application/json", ...(p.extra ?? {}) },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
      });
      if (!r.ok) { console.error(`[detect_wa_consent] ${p.name} ${r.status}`); continue; }
      const j = await r.json();
      let txt = j?.choices?.[0]?.message?.content || "{}";
      txt = String(txt).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(txt);
      const v = String(parsed?.veredicto ?? "").toLowerCase();
      if (!["autorizado", "rechazado", "no_tratado", "dudoso"].includes(v)) continue;
      return {
        veredicto: v,
        cita_textual: String(parsed?.cita_textual ?? "").trim(),
        confianza: Math.max(0, Math.min(1, Number(parsed?.confianza ?? 0.5))),
      };
    } catch (e) { console.error(`[detect_wa_consent] provider exception`, e); }
  }
  return null;
}

async function processOne(sb: any, call: any): Promise<{ ok: boolean; skip?: string; veredicto?: string }> {
  const hsCallId = String(call.hs_id);
  const transcript = String(call.hs_call_transcription ?? "").trim();
  if (transcript.length < 60) return { ok: false, skip: "transcript_too_short" };

  // owner_id vía external_ids del primer contacto asociado
  const contactIds: string[] = call.associated_contact_ids ?? [];
  let ownerId: string | null = null;
  if (contactIds.length) {
    const { data: ext } = await sb.from("external_ids")
      .select("entity_id, provider_id")
      .eq("entity_type", "owner").eq("provider", "hubspot")
      .in("provider_id", contactIds);
    ownerId = ext?.[0]?.entity_id ?? null;
  }
  if (!ownerId) return { ok: false, skip: "no_owner" };

  // Skip si ya existe fila
  const { data: prev } = await sb.from("wa_consent_signals")
    .select("id, veredicto").eq("owner_id", ownerId).eq("hs_call_id", hsCallId).maybeSingle();
  if (prev) return { ok: false, skip: "already_analyzed" };

  const out = await callLLM(buildPrompt(transcript));
  if (!out) return { ok: false, skip: "llm_fail" };

  const requiresCita = out.veredicto === "autorizado" || out.veredicto === "rechazado";
  if (requiresCita && !out.cita_textual) {
    // Degradar a dudoso si falta la evidencia
    out.veredicto = "dudoso";
  }

  const telefono = String(call.hs_call_to_number || call.hs_call_from_number || "").trim() || null;

  // VALIDACIÓN LEGAL: la cita debe existir literalmente, estar atribuida al
  // propietario y contener una aceptación explícita. Además, cualquier veto
  // de privacidad bloquea el consentimiento y abre incidencia.
  const { data: ownerRow } = await sb.from("owners").select("telefono").eq("id", ownerId).maybeSingle();
  const val = validarConsentimiento({
    veredicto: out.veredicto as any,
    cita: out.cita_textual,
    transcripcion: transcript,
    telefonoLlamada: telefono,
    telefonoFicha: (ownerRow as any)?.telefono ?? null,
  });

  const veredictoFinal = val.veredicto;
  const { error } = await sb.from("wa_consent_signals").insert({
    owner_id: ownerId,
    hs_call_id: hsCallId,
    veredicto: veredictoFinal,
    cita_textual: out.cita_textual || null,
    telefono,
    confianza: val.apto_para_escritura ? out.confianza : Math.min(out.confianza, 0.5),
    fecha_llamada: call.hs_timestamp ?? null,
    escrito_en_hubspot: false,
    origen: "sistema",
    validacion: val as any,
    veto_motivos: val.vetos,
    review_status: val.requiere_revision ? "pendiente_revision" : null,
    review_reason: val.requiere_revision ? val.motivos.join(", ") : null,
    review_updated_at: val.requiere_revision ? new Date().toISOString() : null,
  });

  if (val.vetos.length) {
    await sb.from("wa_consent_incidencias").insert({
      owner_id: ownerId,
      hs_call_id: hsCallId,
      tipo: "veto_privacidad",
      motivos: val.vetos,
      detalle: "La llamada contiene una objeción de privacidad; el consentimiento queda bloqueado.",
    });
  }
  if (error && !String(error.message).includes("duplicate")) {
    console.error(`[detect_wa_consent] insert fail ${hsCallId}: ${error.message}`);
    return { ok: false, skip: `insert:${error.message}` };
  }
  return { ok: true, veredicto: veredictoFinal };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const t0 = Date.now();

  // MODO single: analiza una llamada concreta (para post-analysis hook)
  if (body.hs_call_id) {
    const { data: c } = await sb.from("hubspot_calls")
      .select("id, hs_id, hs_timestamp, hs_call_transcription, associated_contact_ids, hs_call_to_number, hs_call_from_number")
      .eq("hs_id", String(body.hs_call_id)).maybeSingle();
    if (!c) return new Response(JSON.stringify({ ok: false, error: "not_found" }), { status: 404, headers: corsHeaders });
    const r = await processOne(sb, c);
    return new Response(JSON.stringify({ ...r, hs_id: c.hs_id, elapsed_ms: Date.now() - t0 }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const limit = Math.max(1, Math.min(100, Number(body.limit ?? DEFAULT_LIMIT)));
  const onlyWa = body.only_whatsapp === true;

  // Priorizar: primero llamadas que mencionan whatsapp y sin fila previa.
  // Usamos left-join implícito filtrando por NOT IN (subconsulta) vía SQL.
  const { data: prio } = await sb.rpc("pending_wa_consent_calls" as any, { p_limit: limit, p_only_wa: onlyWa }).select?.() ?? { data: null };
  let batch: any[] = [];
  if (prio && Array.isArray(prio) && prio.length) {
    batch = prio;
  } else {
    // Fallback: query directa
    let q = sb.from("hubspot_calls")
      .select("id, hs_id, hs_timestamp, hs_call_transcription, associated_contact_ids, hs_call_to_number, hs_call_from_number")
      .not("hs_call_transcription", "is", null)
      .neq("hs_call_transcription", "");
    if (onlyWa) q = q.ilike("hs_call_transcription", "%whats%");
    const { data } = await q.order("hs_timestamp", { ascending: false }).limit(limit * 3);
    // Filtrar los ya analizados
    if (data && data.length) {
      const hsIds = data.map((r: any) => String(r.hs_id));
      const { data: existing } = await sb.from("wa_consent_signals")
        .select("hs_call_id").in("hs_call_id", hsIds);
      const seen = new Set((existing || []).map((r: any) => String(r.hs_call_id)));
      batch = data.filter((r: any) => !seen.has(String(r.hs_id))).slice(0, limit);
    }
  }

  const results = { processed: 0, autorizado: 0, rechazado: 0, no_tratado: 0, dudoso: 0, skipped: 0 };
  const CONC = 3;
  let idx = 0;
  const worker = async () => {
    while (idx < batch.length) {
      const i = idx++;
      const r = await processOne(sb, batch[i]);
      results.processed++;
      if (r.ok && r.veredicto) (results as any)[r.veredicto]++;
      else results.skipped++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, batch.length) }, () => worker()));

  const { count: totalDone } = await sb.from("wa_consent_signals").select("id", { count: "exact", head: true });
  const { count: totalTrans } = await sb.from("hubspot_calls").select("id", { count: "exact", head: true })
    .not("hs_call_transcription", "is", null).neq("hs_call_transcription", "");

  return new Response(JSON.stringify({
    ok: true, accepted: batch.length, ...results,
    total_signals: totalDone, total_transcriptions: totalTrans,
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});