// Cron drain: reintenta finalize_call_session cuando la transcripción de HubSpot
// no llegó a tiempo. Se programa cada minuto y llama a finalize_call_session solo
// para las filas cuyo next_retry_at ya venció y aún queden reintentos.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowIso = new Date().toISOString();
  const { data: due } = await admin.from("call_sessions")
    .select("id, hubspot_call_id, retries_left")
    .lte("next_retry_at", nowIso)
    .gt("retries_left", 0)
    .limit(20);

  const results: any[] = [];
  for (const row of (due as any[] ?? [])) {
    try {
      const r = await admin.functions.invoke("finalize_call_session", {
        body: { session_id: row.id, retry: true },
      });
      results.push({ id: row.id, ok: !r.error, err: r.error?.message });
    } catch (e) {
      results.push({ id: row.id, ok: false, err: (e as Error).message });
    }
  }
  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});