// transcript_ingest — Recibe transcripciones diarizadas capturadas del DOM
// de HubSpot (bookmarklet) y las guarda en hubspot_calls.hs_call_transcription.
// Dispara re-análisis inmediato con agent_voss_coach para actualizar KPIs/expediente.
//
// POST JSON: { key, hs_call_id, transcript_text, source? }
// Respuesta: { ok, chars, reanalisis }
//
// verify_jwt=false, protegida por app_settings.transcript_ingest_key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, error: "method_not_allowed" }, 405);

  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);

  let body: any = {};
  try { body = await req.json(); } catch { return j({ ok: false, error: "invalid_json" }, 400); }
  const key: string = String(body?.key ?? "");
  const hsCallId: string = String(body?.hs_call_id ?? "").trim();
  const text: string = String(body?.transcript_text ?? "");
  const source: string = String(body?.source ?? "hubspot_ui");

  if (!key || !hsCallId || !text) return j({ ok: false, error: "missing_params" }, 400);
  if (text.length < 20) return j({ ok: false, error: "transcript_too_short" }, 400);

  // 1) Auth por app_settings
  const { data: keyRow } = await sb.from("app_settings").select("value").eq("key", "transcript_ingest_key").maybeSingle();
  const expected = typeof keyRow?.value === "string" ? keyRow.value : (keyRow?.value as any);
  if (!expected || key !== expected) return j({ ok: false, error: "unauthorized" }, 401);

  // 2) Buscar la llamada
  const { data: call, error: callErr } = await sb.from("hubspot_calls")
    .select("id, hs_id, hs_call_duration, hs_call_summary, hs_call_transcription, associated_contact_ids, raw")
    .eq("hs_id", hsCallId)
    .maybeSingle();
  if (callErr) return j({ ok: false, error: callErr.message }, 500);
  if (!call) return j({ ok: false, error: "call_not_found", hs_call_id: hsCallId }, 404);

  // 3) Decidir sobrescritura: aceptar si el nuevo es diarizado ("[") o más largo
  const clean = text.trim();
  const isDiarized = clean.startsWith("[");
  const prev = (call.hs_call_transcription ?? "").trim();
  const shouldWrite = !prev || isDiarized || clean.length > prev.length;
  if (!shouldWrite) {
    return j({ ok: true, chars: prev.length, reanalisis: false, skipped: "existing_longer" });
  }

  const rawObj = (call.raw && typeof call.raw === "object") ? call.raw : {};
  const nextRaw = {
    ...rawObj,
    _transcript_source: source,
    _transcript_ingested_at: new Date().toISOString(),
    _transcript_diarized: isDiarized,
    // Forzamos re-análisis limpiando el marcador de auto_analyze
    _auto_analyzed_at: null,
  };

  const { error: updErr } = await sb.from("hubspot_calls").update({
    hs_call_transcription: clean,
    raw: nextRaw,
  }).eq("id", call.id);
  if (updErr) return j({ ok: false, error: updErr.message }, 500);

  // 4) Re-análisis inline con agent_voss_coach (best-effort)
  let reanalisis = false;
  try {
    const contactIds: string[] = call.associated_contact_ids ?? [];
    let ownerId: string | null = null;
    if (contactIds.length) {
      const { data: ext } = await sb.from("external_ids")
        .select("entity_id, provider_id")
        .eq("entity_type", "owner").eq("provider", "hubspot")
        .in("provider_id", contactIds);
      ownerId = ext?.[0]?.entity_id ?? null;
    }
    if (ownerId) {
      const r = await fetch(`${SUP}/functions/v1/agent_voss_coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}` },
        body: JSON.stringify({
          mode: "post",
          owner_id: ownerId,
          call_transcript: clean,
          call_duration_seg: call.hs_call_duration == null ? null : Math.round(Number(call.hs_call_duration) / 1000),
          call_summary: call.hs_call_summary ?? null,
        }),
      });
      const jr = await r.json().catch(() => ({}));
      const okAnalysis = r.ok && jr?.ok !== false;
      await sb.from("hubspot_calls").update({
        raw: {
          ...nextRaw,
          _auto_analyzed_at: new Date().toISOString(),
          _auto_analysis: okAnalysis ? (jr?.voss ?? jr) : null,
          _auto_analysis_error: okAnalysis ? null : (jr?.error || `status ${r.status}`),
          _auto_analysis_owner_id: ownerId,
          _auto_analysis_trigger: "transcript_ingest",
        },
      }).eq("id", call.id);
      reanalisis = okAnalysis;
    }
  } catch (e) {
    console.error("reanalysis failed:", (e as Error).message);
  }

  return j({ ok: true, chars: clean.length, diarized: isDiarized, reanalisis });
});