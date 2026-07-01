// Reaper de wa_ai_jobs (R2). Si el fetch fire-and-forget del webhook nunca completó
// (caída de red, reinicio, timeout), el job se queda 'pending' para siempre y el bot
// se queda mudo. Este cron reanima los jobs 'pending' estancados re-disparando
// wa_ai_reply. El MUTEX atómico de wa_ai_reply (FIX A) hace seguro el re-disparo:
// no provoca doble respuesta. Para no reintentar infinitamente, llevamos la cuenta en
// la columna `attempts`; al 3er intento marcamos el job 'error' (reason: max_retries).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_MS = 60 * 1000; // 'pending' más viejo que 60s = el fetch nunca completó
const MAX_ATTEMPTS = 3;
const BATCH = 50;
const RUNNING_STALE_MS = 3 * 60 * 1000; // un 'running' sin avanzar >3 min = wa_ai_reply murió a medias

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    // KILL SWITCH GLOBAL: si is_active=false no re-disparamos ningún job (evita que el
    // reaper resucite envíos automáticos mientras el bot está parado).
    const { data: cfg } = await admin.from("wa_bot_config").select("is_active").limit(1).maybeSingle();
    if ((cfg as any)?.is_active === false) {
      return new Response(JSON.stringify({ ok: true, skip: "kill_switch" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let refired = 0;
    let errored = 0;

    // RESCATE de jobs 'running' colgados: wa_ai_reply los reclamó pero murió antes de 'done'.
    const runCutoff = new Date(Date.now() - RUNNING_STALE_MS).toISOString();
    const { data: stuckRunning } = await admin
      .from("wa_ai_jobs")
      .select("id, conversation_id, attempts, updated_at")
      .eq("status", "running")
      .lt("updated_at", runCutoff)
      .order("updated_at", { ascending: true })
      .limit(BATCH);
    for (const job of stuckRunning ?? []) {
      const attempts = Number((job as any).attempts ?? 0);
      if (attempts >= MAX_ATTEMPTS) {
        await admin.from("wa_ai_jobs").update({
          status: "error", error: "max_retries_running", updated_at: new Date().toISOString(),
        }).eq("id", (job as any).id).eq("status", "running");
        errored++;
        continue;
      }
      // Devolver a 'pending' (el trigger refresca updated_at) y re-disparar wa_ai_reply.
      await admin.from("wa_ai_jobs").update({
        status: "pending", attempts: attempts + 1, updated_at: new Date().toISOString(),
      }).eq("id", (job as any).id).eq("status", "running");
      fetch(`${SUPABASE_URL}/functions/v1/wa_ai_reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ conversation_id: (job as any).conversation_id }),
      }).catch(() => {});
      refired++;
    }

    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    const { data: stale } = await admin
      .from("wa_ai_jobs")
      .select("id, conversation_id, attempts, updated_at")
      .eq("status", "pending")
      .lt("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(BATCH);

    for (const job of stale ?? []) {
      const attempts = Number((job as any).attempts ?? 0);
      if (attempts >= MAX_ATTEMPTS) {
        await admin.from("wa_ai_jobs").update({
          status: "error",
          error: "max_retries",
          updated_at: new Date().toISOString(),
        }).eq("id", (job as any).id).eq("status", "pending");
        errored++;
        continue;
      }
      // Incrementa intentos. El trigger wa_ai_jobs_set_updated_at refresca updated_at,
      // así que este job no se vuelve a recoger hasta pasados otros 60s.
      await admin.from("wa_ai_jobs").update({
        attempts: attempts + 1,
        updated_at: new Date().toISOString(),
      }).eq("id", (job as any).id).eq("status", "pending");
      // Re-dispara el MISMO POST que hace el webhook. El mutex atómico evita doble respuesta.
      fetch(`${SUPABASE_URL}/functions/v1/wa_ai_reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({ conversation_id: (job as any).conversation_id }),
      }).catch(() => {});
      refired++;
    }

    return new Response(JSON.stringify({ ok: true, scanned: (stale ?? []).length, running_rescued: (stuckRunning ?? []).length, refired, errored }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
