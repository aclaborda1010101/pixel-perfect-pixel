// batch_analyze_notas_pendientes
// Procesa N notas_simples en status='pendiente' invocando analyze_nota_simple
// con concurrency configurable (default 5). Devuelve summary final.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return json({ error: "missing bearer token" }, 401);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(500, Number(body?.limit) || 100));
  const concurrency = Math.max(1, Math.min(10, Number(body?.concurrency) || 5));

  const { data: pendientes, error: selErr } = await supabase
    .from("notas_simples")
    .select("id")
    .eq("status", "pendiente")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (selErr) return json({ error: `db: ${selErr.message}` }, 500);

  const ids = (pendientes ?? []).map((r: any) => r.id as string);
  if (ids.length === 0) {
    return json({ ok: true, picked: 0, summary: {}, elapsed_ms: Date.now() - t0 });
  }

  const results: { id: string; ok: boolean; status?: string; error?: string }[] = [];

  async function processOne(id: string) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze_nota_simple`, {
        method: "POST",
        headers: {
          // Forward the caller's JWT (verify_jwt=true en analyze_nota_simple
          // rechaza el service_role key en algunos entornos). El JWT del caller
          // ya está validado por el gateway antes de llegar aquí.
          Authorization: auth,
          apikey: ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nota_simple_id: id }),
      });
      const txt = await res.text();
      if (!res.ok) {
        results.push({ id, ok: false, error: `${res.status}: ${txt.slice(0, 200)}` });
      } else {
        // Parsear respuesta — analyze devuelve {ok:true, ...} o {error:...}
        try {
          const j = JSON.parse(txt);
          if (j?.ok === true) {
            results.push({ id, ok: true });
          } else {
            results.push({ id, ok: false, error: j?.error ?? "no ok flag" });
          }
        } catch {
          results.push({ id, ok: false, error: `non-json: ${txt.slice(0, 200)}` });
        }
      }
    } catch (e) {
      results.push({ id, ok: false, error: String((e as Error).message ?? e).slice(0, 200) });
    }
  }

  // pool con concurrency fija
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const i = cursor++;
      await processOne(ids[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // re-leer status final
  const { data: finales } = await supabase
    .from("notas_simples")
    .select("id, status, error_message")
    .in("id", ids);

  const summary: Record<string, number> = {};
  const errores: { id: string; error_message: string | null }[] = [];
  for (const r of finales ?? []) {
    summary[r.status] = (summary[r.status] ?? 0) + 1;
    if (r.status === "error") errores.push({ id: r.id, error_message: r.error_message });
  }

  return json({
    ok: true,
    picked: ids.length,
    concurrency,
    summary,
    errores,
    elapsed_ms: Date.now() - t0,
  });
});