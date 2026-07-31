// audit_calls_retro
// Drenaje de expedientes: audita TODA llamada de HubSpot con transcripción no
// vacía que aún NO tiene expediente en call_sessions (sin filtro de duración ni
// de disposition). Prioriza 1º propietarios con edificio, 2º fecha descendente.
//
// Para cada llamada:
//   1) Resuelve owner via external_ids (contactos asociados).
//   2) Llama a agent_voss_coach (mode=post) con el verbatim.
//   3) Inserta un call_session marcado con retroactiva=true, asignado al
//      comercial (auth user) que corresponde al hs_owner_id cuando existe;
//      si no, a Agustín (admin) como fallback. `iniciada_at` = fecha real de
//      la llamada, `puntuacion` = score del voss_post, `comercial_email`
//      denormalizado (hubspot_owners.email) para que Productividad lo agregue
//      aunque no exista fila en `calls`.
//   4) Idempotente: si ya hay call_session para ese hs_id, salta.
//   5) Tras cada análisis con señal, recalcula compute_score_total(building_id).
//
// Params opcionales: { limit?: number, dry_run?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const DEFAULT_LIMIT = 12;      // lote por invocación
const CONCURRENCY = 4;         // paralelismo controlado sobre el LLM
const TIME_BUDGET_MS = 110_000;

// Fallback fijo (admin) para llamadas cuyo hs_owner_id no mapea a un auth.user.
// RLS: los expedientes retroactivos se leen por policy sessions_select_retroactiva_public.
const ADMIN_FALLBACK_USER_ID = "4c05aaaa-67da-4a44-b8e3-28f07403914c";

function toSecs(ms: number | null | undefined): number | null {
  if (ms == null) return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 1000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const limit = Math.max(1, Math.min(100, body.limit ?? DEFAULT_LIMIT));
  const dry = !!body.dry_run;
  const t0 = Date.now();
  const out: any[] = [];

  try {
    // 1) Cola pendiente: 1º propietarios con edificio, 2º fecha descendente.
    const { data: pending, error: qErr } = await sb.from("v_retro_audit_queue")
      .select("hs_id, hs_timestamp, hs_call_duration, hs_owner_id, associated_contact_ids, tiene_edificio")
      .order("tiene_edificio", { ascending: false })
      .order("hs_timestamp", { ascending: false })
      .limit(limit * 3);
    if (qErr) throw qErr;

    const { data: progress0 } = await sb.from("v_retro_audit_progress").select("*").maybeSingle();
    const { data: logRow } = await sb.from("hubspot_sync_log").insert({
      entity: "auto_analyze_backfill", status: "running",
      metadatos: { pendientes_inicio: (progress0 as any)?.pendientes ?? null, limit },
    }).select("id").maybeSingle();
    const logId = (logRow as any)?.id ?? null;

    const finish = async (status: string, processed: number, errors: number, errMsg?: string) => {
      const { data: prog } = await sb.from("v_retro_audit_progress").select("*").maybeSingle();
      if (logId) {
        await sb.from("hubspot_sync_log").update({
          finished_at: new Date().toISOString(), status,
          records_upserted: processed, records_failed: errors,
          error_message: errMsg ?? null,
          metadatos: {
            procesadas: processed,
            pendientes_restantes: (prog as any)?.pendientes ?? null,
            pendientes_con_edificio: (prog as any)?.pendientes_con_edificio ?? null,
          },
        }).eq("id", logId);
      }
      await sb.from("hubspot_sync_state").upsert({
        entity: "auto_analyze",
        last_run_status: status,
        last_run_at: new Date().toISOString(),
        last_error: errMsg ?? null,
        metadatos: {
          pendientes: (prog as any)?.pendientes ?? null,
          pendientes_con_edificio: (prog as any)?.pendientes_con_edificio ?? null,
          auditadas: (prog as any)?.auditadas ?? null,
          ultimo_lote: processed,
        },
      }, { onConflict: "entity" });
      return prog;
    };

    if (!pending?.length) {
      const prog = await finish("ok", 0, 0);
      return new Response(JSON.stringify({ ok: true, processed: 0, out: [], progress: prog, message: "cola vacía" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Precarga mapeos comerciales.
    const { data: owners } = await sb.from("hubspot_owners").select("hs_owner_id, email, full_name");
    const ownerEmailByHs = new Map<string, { email: string | null; full_name: string | null }>();
    for (const o of owners ?? []) ownerEmailByHs.set(String(o.hs_owner_id), { email: o.email, full_name: o.full_name });

    const { data: profs } = await sb.from("profiles").select("id, email");
    const authByEmail = new Map<string, string>();
    for (const p of profs ?? []) if (p.email) authByEmail.set(String(p.email).toLowerCase(), String(p.id));

    let processed = 0, errors = 0, rateLimited = false;

    const auditOne = async (q: any) => {
      // 2) Cargar la llamada completa (transcripción, summary, duración).
      const { data: c } = await sb.from("hubspot_calls")
        .select("id, hs_id, hs_timestamp, hs_call_duration, hs_call_transcription, hs_call_summary, hs_call_disposition, associated_contact_ids, hs_owner_id, raw")
        .eq("hs_id", q.hs_id).maybeSingle();
      if (!c) return { hs_id: q.hs_id, skip: "call not found" };

      // Idempotencia en caliente.
      const { data: existing } = await sb.from("call_sessions")
        .select("id").eq("hubspot_call_id", c.hs_id).limit(1).maybeSingle();
      if (existing?.id) return { hs_id: c.hs_id, skip: "ya auditada" };

      // 3) Owner interno (external_ids).
      const contactIds: string[] = (c.associated_contact_ids ?? []) as string[];
      if (!contactIds.length) return { hs_id: c.hs_id, skip: "sin contactos hubspot" };
      const { data: ext } = await sb.from("external_ids")
        .select("entity_id, provider_id")
        .eq("entity_type", "owner").eq("provider", "hubspot")
        .in("provider_id", contactIds);
      const ownerId = ext?.[0]?.entity_id ?? null;
      if (!ownerId) return { hs_id: c.hs_id, skip: "owner no en cartera" };

      const hsOwner = c.hs_owner_id ? ownerEmailByHs.get(String(c.hs_owner_id)) : null;
      const comercialEmail = hsOwner?.email ?? null;
      const comercialId = (comercialEmail && authByEmail.get(comercialEmail.toLowerCase())) || ADMIN_FALLBACK_USER_ID;

      if (dry) return { hs_id: c.hs_id, owner_id: ownerId, comercial_email: comercialEmail, would_audit: true, _ok: true };

      const transcript = c.hs_call_transcription || "";
      if (transcript.length < 40) return { hs_id: c.hs_id, skip: "transcript vacío" };

      let voss: any = null; let score: number | null = null; let aiErr: string | null = null;
      try {
        const r = await fetch(`${SUP}/functions/v1/agent_voss_coach`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}` },
          body: JSON.stringify({
            mode: "post",
            owner_id: ownerId,
            call_transcript: transcript,
            call_duration_seg: toSecs(c.hs_call_duration),
            call_summary: c.hs_call_summary ?? null,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 429) { rateLimited = true; return { hs_id: c.hs_id, error: "rate_limit_429" }; }
        if (!r.ok || j?.ok === false) aiErr = j?.error || `status ${r.status}`;
        else {
          voss = j?.voss ?? null;
          score = voss?.puntuacion?.score_0_100 ?? voss?.puntuacion?.score ?? null;
        }
      } catch (e: any) { aiErr = e?.message || String(e); }

      if (!voss) return { hs_id: c.hs_id, error: aiErr || "no voss" };

      voss._retroactiva = true;
      voss._nota_retro = "Auditoría retroactiva · sin KPIs objetivo definidos (no había brief previo).";

      // Edificio: v_owner_calls_enriched y, si no, el edificio del propietario.
      let buildingId: string | null = null;
      try {
        const { data: ownerCall } = await (sb.from("v_owner_calls_enriched" as any) as any)
          .select("building_id").eq("owner_id", ownerId).eq("hs_id", c.hs_id).maybeSingle();
        buildingId = (ownerCall as any)?.building_id ?? null;
      } catch (_) { /* vista opcional */ }
      if (!buildingId) {
        const { data: bo } = await sb.from("building_owners")
          .select("building_id").eq("owner_id", ownerId).limit(1).maybeSingle();
        buildingId = (bo as any)?.building_id ?? null;
      }

      const insertRow: any = {
        comercial_id: comercialId,
        comercial_email: comercialEmail,
        owner_id: ownerId,
        building_id: buildingId,
        paso: 3,
        estado: "finalizada",
        hubspot_call_id: c.hs_id,
        iniciada_at: c.hs_timestamp ?? new Date().toISOString(),
        finalizada_at: c.hs_timestamp ?? new Date().toISOString(),
        cerrada_at: c.hs_timestamp ?? new Date().toISOString(),
        resultado: "retroactiva",
        voss_post: voss,
        puntuacion: score,
        kpis_objetivo: null,
        retroactiva: true,
        checklist: [],
      };

      const { data: ins, error: insErr } = await sb.from("call_sessions").insert(insertRow).select("id").maybeSingle();
      if (insErr) return { hs_id: c.hs_id, error: `insert: ${insErr.message}` };

      // 5) Cadena llamada → análisis → score: recalcula el score del edificio.
      let scoreRecalc: any = null;
      if (buildingId) {
        const { data: st, error: stErr } = await sb.rpc("compute_score_total", { p_building_id: buildingId });
        scoreRecalc = stErr ? { error: stErr.message } : st;
      }

      return { hs_id: c.hs_id, owner_id: ownerId, building_id: buildingId, session_id: ins?.id, score, score_total: scoreRecalc, comercial_email: comercialEmail, _ok: true };
    };

    // Lotes en paralelo controlado.
    const queue = (pending as any[]).slice(0, limit);
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      if (rateLimited || Date.now() - t0 > TIME_BUDGET_MS) break;
      const slice = queue.slice(i, i + CONCURRENCY);
      const res = await Promise.all(slice.map((q) => auditOne(q).catch((e) => ({ hs_id: q.hs_id, error: String(e?.message ?? e) }))));
      for (const r of res as any[]) {
        out.push(r);
        if (r?._ok) processed++;
        else if (r?.error) errors++;
      }
    }

    const progress = await finish(errors && !processed ? "error" : "ok", processed, errors, rateLimited ? "rate_limit_429" : undefined);

    return new Response(JSON.stringify({
      ok: true, processed, errors, rate_limited: rateLimited, elapsed_ms: Date.now() - t0, progress, out,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e), out }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
