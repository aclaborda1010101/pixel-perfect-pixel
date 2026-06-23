// fetch_iee_madrid_batch — refresca IEE para edificios obsoletos.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, key);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body?.limit ?? 30), 100);
    const ninetyAgo = new Date(Date.now() - 90 * 86400 * 1000).toISOString();

    // Prioriza: cartera activa primero, luego score alto, luego cualquiera.
    const { data: rows, error } = await admin
      .from("buildings")
      .select("id, iee_estado, iee_actualizado_at, score")
      .or(`iee_estado.eq.desconocido,iee_actualizado_at.lt.${ninetyAgo}`)
      .order("score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;

    let ok = 0, fail = 0;
    const byEstado: Record<string, number> = {};
    for (const r of rows ?? []) {
      try {
        const res = await fetch(`${url}/functions/v1/fetch_iee_madrid`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ building_id: (r as any).id }),
        });
        const j = await res.json();
        if (j?.ok) { ok++; byEstado[j.estado] = (byEstado[j.estado] ?? 0) + 1; }
        else fail++;
      } catch { fail++; }
    }

    return new Response(JSON.stringify({ ok: true, processed: rows?.length ?? 0, ok_count: ok, fail, by_estado: byEstado }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});