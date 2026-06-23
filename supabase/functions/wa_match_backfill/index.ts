// wa_match_backfill — recorre wa_contacts y aplica match_owner_by_phone
// para identificar contactos contra owners ya existentes en la BD.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const force: boolean = !!body?.force;
    const limit: number = Math.min(Number(body?.limit ?? 5000), 20000);

    let q = admin.from("wa_contacts").select("id, phone, lead_id, metadata").limit(limit);
    if (!force) q = q.is("lead_id", null);
    const { data: contacts, error } = await q;
    if (error) throw error;

    let matched = 0, ambiguous = 0, none = 0, failed = 0;
    for (const c of contacts ?? []) {
      try {
        const { data: rows } = await admin.rpc("match_owner_by_phone", { p_phone: (c as any).phone });
        const m = Array.isArray(rows) ? rows[0] : rows;
        const status = m?.match_status ?? "none";
        if (status === "matched") matched++;
        else if (status === "ambiguous") ambiguous++;
        else none++;
        const md = (c as any).metadata ?? {};
        await admin.from("wa_contacts").update({
          lead_id: m?.owner_id ?? null,
          metadata: {
            ...md,
            match_status: status,
            matched_at: new Date().toISOString(),
            matched_owner_nombre: m?.owner_nombre ?? null,
            matched_buildings: m?.buildings ?? [],
          },
        }).eq("id", (c as any).id);
      } catch (e) {
        failed++;
        console.warn("backfill row failed", (e as any)?.message);
      }
    }

    return new Response(JSON.stringify({
      ok: true, scanned: contacts?.length ?? 0, matched, ambiguous, none, failed,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});