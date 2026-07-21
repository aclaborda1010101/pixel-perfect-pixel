// audit_calls_retro
// Batch job: audita RETROACTIVAMENTE llamadas históricas de HubSpot que ya tienen
// transcripción/verbatim, disposition CONECTADA (4 GUIDs) y >=60s, y que aún
// NO tienen expediente guardado (voss_post en call_sessions).
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
//   4) Idempotente: si ya hay call_session con voss_post para ese hs_id, salta.
//
// Params opcionales: { limit?: number, dry_run?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const DEFAULT_LIMIT = 20;
const CONNECTED_DISPOSITIONS = [
  "f240bbac-87c9-4f6e-bf70-924b57d47db7",
  "55428849-9fbc-4038-92d6-7c4f2b850974",
  "371c7887-c871-4c38-b0e7-77bafc4de124",
  "ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7",
];

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
    // 1) Cola pendiente (ordenada por antigüedad para vaciarla progresivamente).
    const { data: pending, error: qErr } = await sb.from("v_retro_audit_queue")
      .select("hs_id, hs_timestamp, hs_call_duration, hs_owner_id, associated_contact_ids")
      .order("hs_timestamp", { ascending: false })
      .limit(limit * 4);
    if (qErr) throw qErr;
    if (!pending?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0, out: [], message: "cola vacía" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Precarga mapeos comerciales.
    const { data: owners } = await sb.from("hubspot_owners").select("hs_owner_id, email, full_name");
    const ownerEmailByHs = new Map<string, { email: string | null; full_name: string | null }>();
    for (const o of owners ?? []) ownerEmailByHs.set(String(o.hs_owner_id), { email: o.email, full_name: o.full_name });

    const { data: profs } = await sb.from("profiles").select("id, email");
    const authByEmail = new Map<string, string>();
    for (const p of profs ?? []) if (p.email) authByEmail.set(String(p.email).toLowerCase(), String(p.id));

    let processed = 0;
    for (const q of pending) {
      if (processed >= limit) break;

      // 2) Cargar la llamada completa (transcripción, summary, duración).
      const { data: c } = await sb.from("hubspot_calls")
        .select("id, hs_id, hs_timestamp, hs_call_duration, hs_call_transcription, hs_call_summary, hs_call_disposition, associated_contact_ids, hs_owner_id, raw")
        .eq("hs_id", q.hs_id).maybeSingle();
      if (!c) { out.push({ hs_id: q.hs_id, skip: "call not found" }); continue; }

      // Re-check idempotencia en caliente (por si otro run avanzó).
      const { data: existing } = await sb.from("call_sessions")
        .select("id").eq("hubspot_call_id", c.hs_id).not("voss_post", "is", null).limit(1).maybeSingle();
      if (existing?.id) { out.push({ hs_id: c.hs_id, skip: "ya auditada" }); continue; }

      // 3) Owner interno (external_ids).
      const contactIds: string[] = (c.associated_contact_ids ?? []) as string[];
      if (!contactIds.length) { out.push({ hs_id: c.hs_id, skip: "sin contactos hubspot" }); continue; }
      const { data: ext } = await sb.from("external_ids")
        .select("entity_id, provider_id")
        .eq("entity_type", "owner").eq("provider", "hubspot")
        .in("provider_id", contactIds);
      const ownerId = ext?.[0]?.entity_id ?? null;
      if (!ownerId) { out.push({ hs_id: c.hs_id, skip: "owner no en cartera" }); continue; }

      // Comercial: hs_owner_id → email → auth.user (si existe). Fallback admin.
      const hsOwner = c.hs_owner_id ? ownerEmailByHs.get(String(c.hs_owner_id)) : null;
      const comercialEmail = hsOwner?.email ?? null;
      const comercialId = comercialEmail && authByEmail.get(comercialEmail.toLowerCase()) || ADMIN_FALLBACK_USER_ID;

      if (dry) {
        out.push({ hs_id: c.hs_id, owner_id: ownerId, comercial_email: comercialEmail, would_audit: true });
        processed++; continue;
      }

      // 4) Analizar via agent_voss_coach mode=post.
      const transcript = c.hs_call_transcription || "";
      if (transcript.length < 40) { out.push({ hs_id: c.hs_id, skip: "transcript vacío" }); continue; }

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
        if (r.status === 429) {
          // Rate limit → parar la corrida y dejar el resto para el siguiente cron.
          out.push({ hs_id: c.hs_id, error: "rate_limit_429" });
          break;
        }
        if (!r.ok || j?.ok === false) {
          aiErr = j?.error || `status ${r.status}`;
        } else {
          voss = j?.voss ?? null;
          score = voss?.puntuacion?.score_0_100 ?? voss?.puntuacion?.score ?? null;
        }
      } catch (e: any) {
        aiErr = e?.message || String(e);
      }

      if (!voss) { out.push({ hs_id: c.hs_id, error: aiErr || "no voss" }); continue; }

      // Anota que es retro y sin KPIs objetivo, sin re-tocar el schema del voss.
      voss._retroactiva = true;
      voss._nota_retro = "Auditoría retroactiva · sin KPIs objetivo definidos (no había brief previo).";

      // Edificio: intenta atribución via v_owner_calls_enriched (misma lógica que resto del app).
      let buildingId: string | null = null;
      try {
        const { data: ownerCall } = await (sb.from("v_owner_calls_enriched" as any) as any)
          .select("building_id").eq("owner_id", ownerId).eq("hs_id", c.hs_id).maybeSingle();
        buildingId = (ownerCall as any)?.building_id ?? null;
      } catch (_) { /* view opcional */ }

      // 5) Insert expediente.
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
      if (insErr) { out.push({ hs_id: c.hs_id, error: `insert: ${insErr.message}` }); continue; }

      out.push({ hs_id: c.hs_id, owner_id: ownerId, session_id: ins?.id, score, comercial_email: comercialEmail });
      processed++;
    }

    // Progreso agregado (informativo).
    const { data: progress } = await sb.from("v_retro_audit_progress").select("*").maybeSingle();

    return new Response(JSON.stringify({
      ok: true, processed, elapsed_ms: Date.now() - t0, progress, out,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e), out }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});