// auto_analyze_hubspot_calls
// JOB DE FONDO: para cada llamada NUEVA en hubspot_calls (asociada a un
// propietario en cartera, con grabación >=45s y transcripción presente),
// dispara agent_voss_coach mode=post y guarda el análisis en raw._auto_analysis.
// Idempotente: marca raw._auto_analyzed_at.
//
// Params opcionales: { limit?: number, dry_run?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const DEFAULT_LIMIT = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const limit = Math.max(1, Math.min(50, body.limit ?? DEFAULT_LIMIT));
  const dry = !!body.dry_run;
  const t0 = Date.now();

  const out: any[] = [];
  try {
    const { data: candidates, error } = await sb.from("hubspot_calls")
      .select("id, hs_id, hs_timestamp, hs_call_duration, hs_call_recording_url, hs_call_transcription, associated_contact_ids, raw")
      .gte("hs_call_duration", 45000)
      .not("hs_call_recording_url", "is", null)
      .neq("hs_call_recording_url", "")
      .not("hs_call_transcription", "is", null)
      .neq("hs_call_transcription", "")
      .order("hs_timestamp", { ascending: false })
      .limit(200);
    if (error) throw error;

    let processed = 0;
    for (const c of candidates ?? []) {
      if (processed >= limit) break;
      const raw = (c.raw && typeof c.raw === "object") ? c.raw : {};
      if (raw._auto_analyzed_at) continue;
      const contactIds: string[] = c.associated_contact_ids ?? [];
      if (!contactIds.length) { out.push({ hs_id: c.hs_id, skip: "no contacts" }); continue; }

      const { data: ext } = await sb.from("external_ids")
        .select("entity_id, provider_id")
        .eq("entity_type", "owner").eq("provider", "hubspot")
        .in("provider_id", contactIds);
      const ownerId = ext?.[0]?.entity_id;
      if (!ownerId) { out.push({ hs_id: c.hs_id, skip: "owner no en cartera" }); continue; }

      if (dry) { out.push({ hs_id: c.hs_id, owner_id: ownerId, would_analyze: true }); processed++; continue; }

      const r = await fetch(`${SUP}/functions/v1/agent_voss_coach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}` },
        body: JSON.stringify({ mode: "post", owner_id: ownerId, call_transcript: c.hs_call_transcription }),
      });
      const j = await r.json().catch(() => ({}));
      const okAnalysis = r.ok && j?.ok !== false;

      const patch = {
        raw: {
          ...raw,
          _auto_analyzed_at: new Date().toISOString(),
          _auto_analysis: okAnalysis ? (j?.voss ?? j) : null,
          _auto_analysis_error: okAnalysis ? null : (j?.error || `status ${r.status}`),
          _auto_analysis_owner_id: ownerId,
        },
      };
      await sb.from("hubspot_calls").update(patch).eq("id", c.id);

      out.push({ hs_id: c.hs_id, owner_id: ownerId, ok: okAnalysis, score: j?.voss?.puntuacion?.score_0_100 ?? null });
      processed++;
    }
    return new Response(JSON.stringify({ ok: true, processed, elapsed_ms: Date.now() - t0, out }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, out }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
