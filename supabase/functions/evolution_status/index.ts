import { createClient } from "npm:@supabase/supabase-js@2";
import { evoFetch, EVOLUTION_INSTANCE } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let status = "disconnected"; let phone: string | null = null;
    try {
      const st = await evoFetch(`/instance/connectionState/${EVOLUTION_INSTANCE}`, { method: "GET" });
      const state = st?.instance?.state ?? st?.state ?? null;
      if (state === "open") status = "connected";
      else if (state === "connecting") status = "connecting";
    } catch (_e) { /* ignore */ }
    try {
      const info = await evoFetch(`/instance/fetchInstances?instanceName=${EVOLUTION_INSTANCE}`, { method: "GET" });
      const i = Array.isArray(info) ? info[0] : info;
      phone = i?.instance?.owner?.split("@")?.[0] ?? i?.owner?.split("@")?.[0] ?? null;
    } catch (_e) { /* ignore */ }
    await admin.from("wa_instances").update({
      status, phone_number: phone, last_seen_at: new Date().toISOString(),
    }).eq("instance_name", EVOLUTION_INSTANCE);
    return new Response(JSON.stringify({ ok: true, status, phone }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});