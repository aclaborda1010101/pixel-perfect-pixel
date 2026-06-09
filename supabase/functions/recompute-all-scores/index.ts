import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* GET ok */ }
  const onlyIds: string[] | undefined = Array.isArray(body?.building_ids) ? body.building_ids : undefined;
  const batchSize: number = Math.max(1, Math.min(500, Number(body?.batch_size ?? 200)));

  // Cargar ids
  let ids: string[] = [];
  if (onlyIds && onlyIds.length) {
    ids = onlyIds;
  } else {
    const { data, error } = await supabase.from("buildings").select("id");
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    ids = (data ?? []).map((r: any) => r.id);
  }

  let ok = 0, fail = 0;
  const errors: { id: string; msg: string }[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      slice.map((id) => supabase.rpc("compute_cluster_score", { p_building_id: id }))
    );
    results.forEach((r, idx) => {
      if (r.status === "fulfilled" && !(r.value as any).error) ok++;
      else {
        fail++;
        errors.push({
          id: slice[idx],
          msg: r.status === "fulfilled" ? String((r.value as any).error?.message) : String((r as any).reason),
        });
      }
    });
    // Backoff between batches
    if (i + batchSize < ids.length) await new Promise((res) => setTimeout(res, 300));
  }

  return new Response(
    JSON.stringify({ total: ids.length, ok, fail, errors: errors.slice(0, 20) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
  );
});