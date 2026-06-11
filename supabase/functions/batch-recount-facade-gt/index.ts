// batch-recount-facade-gt
// Re-corre count-facade-windows en background para los edificios listados en
// facade_window_ground_truth. No bloquea: encadena llamadas con waitUntil.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.building_ids) && body.building_ids.length
    ? body.building_ids
    : ((await sb.from("facade_window_ground_truth").select("building_id")).data ?? []).map((r: any) => r.building_id);

  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/count-facade-windows`;
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const run = async () => {
    for (const id of ids) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${srk}`, apikey: srk },
          body: JSON.stringify({ building_id: id, force: true }),
        });
        const t = await r.text().catch(() => "");
        console.log(`facade rerun ${id} -> ${r.status} ${t.slice(0, 300)}`);
      } catch (e) {
        console.warn(`facade rerun error ${id}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log("batch-recount-facade-gt done");
  };

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, queued: ids.length }), {
    status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});