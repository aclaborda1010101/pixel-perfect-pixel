// batch-refetch-streetview-cohort77
// Re-captura las 4 fotos Street View de los 77 edificios del cohorte con la
// lógica corregida de fetch-google-imagery (sin el "espejo" +180°). Trocea con
// waitUntil y secuencia 1.5s entre peticiones para no saturar el quota de Google.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SB_URL, SRK);

  // Cohorte = edificios con flag reprocess_frozen_v1 OR con GT
  const { data: frozen } = await sb
    .from("building_analysis")
    .select("building_id")
    .filter("metricas_extra", "cs", '{"reprocess_frozen_v1":true}');
  const { data: gt } = await sb.from("qa_ground_truth").select("building_id");
  const ids = Array.from(new Set([
    ...((frozen ?? []).map((r: any) => r.building_id)),
    ...((gt ?? []).map((r: any) => r.building_id)),
  ]));

  const run = async () => {
    let ok = 0, ko = 0;
    for (const id of ids) {
      try {
        const r = await fetch(`${SB_URL}/functions/v1/fetch-google-imagery`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SRK}` },
          body: JSON.stringify({ building_id: id, force: true }),
        });
        if (r.ok) ok++; else ko++;
        console.log(`sv-refetch ${id} -> ${r.status}`);
      } catch (e) {
        ko++;
        console.warn(`sv-refetch ${id} err: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log(`batch-refetch-streetview-cohort77 done ok=${ok} ko=${ko}`);
  };

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, queued: ids.length }), {
    status: 202,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});