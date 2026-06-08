import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { fetchParcelGeometry } from "../_shared/parcel_geometry.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const body = await req.json().catch(() => ({}));
    const { building_id, force } = body as { building_id?: string; force?: boolean };
    if (!building_id) {
      return new Response(JSON.stringify({ error: "building_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: bldg } = await sb.from("buildings")
      .select("refcatastral, metadatos").eq("id", building_id).maybeSingle();
    const rc14 = String(bldg?.refcatastral ?? (bldg?.metadatos as any)?.referencia_catastral ?? "")
      .replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14);
    if (!rc14 || rc14.length < 14) {
      return new Response(JSON.stringify({ error: "sin refcatastral_14" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: auth } = await sb.from("catastro_authority_cache")
      .select("superficie_parcela_m2, lat, lon").eq("refcatastral_14", rc14).maybeSingle();
    const expected = auth?.superficie_parcela_m2 ? Number(auth.superficie_parcela_m2) : null;
    const lat = auth?.lat != null ? Number(auth.lat) : null;
    const lon = auth?.lon != null ? Number(auth.lon) : null;
    const t0 = Date.now();
    const geom = await fetchParcelGeometry({
      refcatastral_14: rc14,
      lat, lon,
      force: !!force,
      sbAdmin: sb,
      expected_area_m2: expected,
    });
    return new Response(JSON.stringify({
      building_id, rc14, ms: Date.now() - t0,
      source: geom.source, confidence: geom.confidence,
      area_m2: geom.area_m2, flags: geom.flags,
      is_corner: geom.is_corner, total_street_length_m: geom.total_street_length_m,
      expected_authority: expected,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});