// guardas_detect — detección horaria de propuestas de las guardas (modo aviso).
// Ejecuta cada guarda por separado (SQL) e inserta propuestas nuevas sin duplicar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "guardas";
const GUARDAS = [1, 2, 4, 6] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const solo: number[] = Array.isArray(body?.guardas) ? body.guardas.map(Number) : [...GUARDAS];

  const t0 = Date.now();
  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { modo: "deteccion", guardas: solo } })
    .select("id").single();
  const logId = logRow?.id;

  const resultados: Record<string, number | string> = {};
  let errores = 0;

  for (const g of GUARDAS) {
    if (!solo.includes(g)) continue;
    try {
      const { data, error } = await (sb.rpc as any)(`detect_guarda_${g}`);
      if (error) throw error;
      resultados[`guarda_${g}`] = Number(data ?? 0);
    } catch (e: any) {
      errores++;
      resultados[`guarda_${g}`] = `error: ${e?.message ?? String(e)}`;
      console.error(`[guardas_detect] guarda ${g}: ${e?.message ?? e}`);
    }
  }

  // Conteo actual de pendientes por guarda
  const pendientes: Record<string, number> = {};
  for (const g of GUARDAS) {
    const { count } = await sb.from("guard_proposals")
      .select("*", { count: "exact", head: true })
      .eq("guarda", g).eq("estado", "pendiente");
    pendientes[`guarda_${g}`] = count ?? 0;
  }

  await sb.from("hubspot_sync_log").update({
    finished_at: new Date().toISOString(),
    status: errores ? "error" : "ok",
    records_failed: errores,
    metadatos: { modo: "deteccion", nuevas: resultados, pendientes, elapsed_ms: Date.now() - t0 },
  }).eq("id", logId);

  return new Response(JSON.stringify({ ok: errores === 0, nuevas: resultados, pendientes, elapsed_ms: Date.now() - t0 }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});