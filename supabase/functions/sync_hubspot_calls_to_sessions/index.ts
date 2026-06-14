// sync_hubspot_calls_to_sessions
// Red de seguridad: para cada call_session abierta (estado != 'finalizada')
// busca si existe una llamada nueva en hubspot_calls del mismo propietario
// posterior a iniciada_at. Si la hay, llama a finalize_call_session.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: any[] = [];
  try {
    const { data: open } = await sb.from("call_sessions")
      .select("id, owner_id, iniciada_at, created_at, estado")
      .neq("estado", "finalizada")
      .is("finalizada_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    for (const s of open ?? []) {
      const since = s.iniciada_at ?? s.created_at;
      const { data: ext } = await sb.from("external_ids")
        .select("provider_id").eq("entity_type", "owner")
        .eq("provider", "hubspot").eq("entity_id", s.owner_id).maybeSingle();
      const hsContactId = ext?.provider_id;
      if (!hsContactId) { out.push({ session_id: s.id, skip: "sin hubspot contact" }); continue; }

      const { data: hsCall } = await sb.from("hubspot_calls")
        .select("hs_id, hs_timestamp")
        .contains("associated_contact_ids", [hsContactId])
        .gte("hs_timestamp", since)
        .order("hs_timestamp", { ascending: false }).limit(1).maybeSingle();
      if (!hsCall) { out.push({ session_id: s.id, skip: "sin hubspot_call nueva" }); continue; }

      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/finalize_call_session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ session_id: s.id }),
      });
      out.push({ session_id: s.id, hs_id: hsCall.hs_id, status: r.status });
    }
    return new Response(JSON.stringify({ ok: true, processed: out.length, out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message, partial: out }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});