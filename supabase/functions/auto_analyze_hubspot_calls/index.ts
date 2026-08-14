// auto_analyze_hubspot_calls
// JOB DE FONDO: para cada llamada NUEVA en hubspot_calls (asociada a un
// propietario en cartera, con grabación >=45s y transcripción presente),
// dispara agent_voss_coach mode=post y guarda el análisis en raw._auto_analysis.
// Idempotente: marca raw._auto_analyzed_at.
//
// Params opcionales: { limit?: number, dry_run?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { acquireJobLock, lockedResponse } from "../_shared/jobLock.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const DEFAULT_LIMIT = 6;
const TIME_BUDGET_MS = 90_000;
const JOB_LOCK = "auto_analyze_hubspot_calls";

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

  const lock = await acquireJobLock(sb, JOB_LOCK, 180);
  if (!lock.acquired) return lockedResponse(JOB_LOCK, corsHeaders);

  const out: any[] = [];
  try {
    const { data: candidates, error } = await sb.from("hubspot_calls")
      .select("id, hs_id, hs_timestamp, hs_call_duration, hs_call_recording_url, hs_call_transcription, hs_call_summary, associated_contact_ids, raw")
      .not("hs_call_transcription", "is", null)
      .neq("hs_call_transcription", "")
      .filter("raw->>_auto_analyzed_at", "is", null)
      .order("hs_timestamp", { ascending: false })
      .limit(limit * 3);
    if (error) throw error;

    let processed = 0;
    for (const c of candidates ?? []) {
      if (processed >= limit) break;
      if (Date.now() - t0 > TIME_BUDGET_MS) { out.push({ stop: "time_budget" }); break; }
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
        body: JSON.stringify({
          mode: "post",
          owner_id: ownerId,
          call_transcript: c.hs_call_transcription,
          call_duration_seg: c.hs_call_duration == null ? null : Math.round(Number(c.hs_call_duration) / 1000),
          call_summary: c.hs_call_summary ?? null,
        }),
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

      // Hook: detección de consentimiento WhatsApp (best-effort, no bloquea)
      try {
        await fetch(`${SUP}/functions/v1/detect_whatsapp_consent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}` },
          body: JSON.stringify({ hs_call_id: c.hs_id }),
        });
      } catch (e) { console.error("[auto_analyze] wa_consent hook fail", e); }

      // Cadena llamada → análisis → score del edificio del propietario.
      let buildingId: string | null = null;
      if (okAnalysis) {
        const { data: bo } = await sb.from("building_owners")
          .select("building_id").eq("owner_id", ownerId).limit(1).maybeSingle();
        buildingId = (bo as any)?.building_id ?? null;
        if (buildingId) {
          const { error: stErr } = await sb.rpc("compute_score_total", { p_building_id: buildingId });
          if (stErr) console.error("[auto_analyze] compute_score_total", stErr.message);
        }
      }

      out.push({ hs_id: c.hs_id, owner_id: ownerId, building_id: buildingId, ok: okAnalysis, score: j?.voss?.puntuacion?.score_0_100 ?? null });
      processed++;
    }
    return new Response(JSON.stringify({ ok: true, processed, elapsed_ms: Date.now() - t0, out }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message, out }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    await lock.release();
  }
});
