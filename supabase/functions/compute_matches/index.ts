import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Asset = {
  id: string; tipo: string; ciudad: string | null;
  valoracion_estimada: number | null; estado: string;
};
type Investor = {
  id: string; nombre: string; tipos_activo: string[]; ciudades: string[];
  ticket_min: number | null; ticket_max: number | null; consentimiento: boolean;
};

function score(a: Asset, i: Investor): { score: number; evidencia: string[] } {
  const ev: string[] = [];
  let s = 0;
  // Tipo (40)
  if (i.tipos_activo?.includes(a.tipo)) {
    s += 0.4; ev.push(`Tipo coincide (${a.tipo})`);
  } else {
    ev.push(`Tipo NO coincide (${a.tipo} vs ${i.tipos_activo?.join(",") || "—"})`);
  }
  // Ciudad (30)
  if (a.ciudad && i.ciudades?.includes(a.ciudad)) {
    s += 0.3; ev.push(`Ciudad coincide (${a.ciudad})`);
  } else {
    ev.push(`Ciudad NO en preferencias (${a.ciudad ?? "?"})`);
  }
  // Ticket (25)
  if (a.valoracion_estimada != null) {
    const min = i.ticket_min ?? 0;
    const max = i.ticket_max ?? Number.POSITIVE_INFINITY;
    if (a.valoracion_estimada >= min && a.valoracion_estimada <= max) {
      s += 0.25; ev.push(`Ticket en rango (${a.valoracion_estimada.toLocaleString()} €)`);
    } else {
      ev.push(`Ticket fuera de rango (${a.valoracion_estimada.toLocaleString()} €)`);
    }
  } else {
    ev.push("Sin valoración para validar ticket");
  }
  // Consentimiento (5)
  if (i.consentimiento) { s += 0.05; } else { ev.push("Inversor sin consentimiento → bloqueado"); s = Math.min(s, 0.5); }
  return { score: Math.round(s * 100) / 100, evidencia: ev };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { threshold = 0.6 } = (await req.json().catch(() => ({}))) as { threshold?: number };
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const [{ data: assets }, { data: investors }, { data: existing }] = await Promise.all([
      supabase.from("assets").select("id,tipo,ciudad,valoracion_estimada,estado")
        .neq("estado", "vendido").neq("estado", "descartado"),
      supabase.from("investors").select("id,nombre,tipos_activo,ciudades,ticket_min,ticket_max,consentimiento"),
      supabase.from("match_candidates").select("asset_id,investor_id,estado"),
    ]);

    const seen = new Set((existing ?? []).map((r: any) => `${r.asset_id}:${r.investor_id}`));
    const toInsert: any[] = [];
    let evaluated = 0;

    for (const a of (assets ?? []) as Asset[]) {
      for (const i of (investors ?? []) as Investor[]) {
        evaluated++;
        if (seen.has(`${a.id}:${i.id}`)) continue;
        const { score: sc, evidencia } = score(a, i);
        if (sc < threshold) continue;
        toInsert.push({
          asset_id: a.id,
          investor_id: i.id,
          score: sc,
          evidencia: evidencia.join(" · "),
          estado: "propuesto",
        });
      }
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      const { error, count } = await supabase.from("match_candidates").insert(toInsert, { count: "exact" });
      if (error) throw error;
      inserted = count ?? toInsert.length;
    }

    return new Response(JSON.stringify({ evaluated, inserted, threshold }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("compute_matches error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});