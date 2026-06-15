// Orquestador: reprocesa el cohorte de 77 edificios con versiones congeladas.
// - Esquina v3:        recompute-corner-detection
// - Escaleras v7-11:   recount-escaleras (modo producción)
// - Ventanas cal5:     recount-windows-cal5  (+ recount-patio-windows si hay)
// - Protección PGOUM:  check-proteccion-pgou
// - Geometría parcela: recompute-parcel-geometry
// - Score:             recompute-cluster-scoring
// Lotes de 6, self-reinvoke hasta vaciar la cola. Persiste progreso en
// building_processing_status.metadata->>'reprocess_frozen' (best effort en error JSON).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_BATCH = 10;
const MAX_MS = 140_000;

async function callFn(name: string, body: any) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, body: text.slice(0, 400) };
  } catch (e: any) {
    return { ok: false, status: 0, body: String(e?.message ?? e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({} as any));
  const BATCH: number = Math.max(1, Math.min(20, Number(body?.batch ?? DEFAULT_BATCH)));

  // Selección: cohorte = building_processing_status (los 77) que aún tengan
  // algún subsistema vacío o no marcado como reprocesado con versión congelada.
  const { data: pend } = await sb
    .from("building_processing_status")
    .select("building_id, error, current_phase, status")
    .order("updated_at", { ascending: true })
    .limit(200);

  // Filtrar por estado real
  const ids: string[] = [];
  for (const r of pend ?? []) {
    const bid = (r as any).building_id;
    const [{ count: nFac }, { count: nPat }, { data: ba }] = await Promise.all([
      sb.from("facade_window_counts").select("building_id", { count: "exact", head: true }).eq("building_id", bid),
      sb.from("patio_window_counts").select("building_id", { count: "exact", head: true }).eq("building_id", bid),
      sb.from("building_analysis").select("n_escaleras_final, esquina, protegido_historicamente, metricas_extra").eq("building_id", bid).maybeSingle(),
    ]);
    const reprocesado = (ba as any)?.metricas_extra?.reprocess_frozen_v1 === true;
    const sinFacade = (nFac ?? 0) === 0;
    const sinPatio = (nPat ?? 0) === 0;
    const sinEsc = (ba as any)?.n_escaleras_final == null;
    if (sinFacade || sinPatio || sinEsc || !reprocesado) ids.push(bid);
    if (ids.length >= BATCH * 4) break;
  }
  const batch = ids.slice(0, BATCH);
  const remaining = Math.max(ids.length - BATCH, 0);

  const results: any[] = [];
  for (const bid of batch) {
    if (Date.now() - t0 > MAX_MS) break;
    const steps: Record<string, any> = {};
    steps.geom    = await callFn("recompute-parcel-geometry",   { building_id: bid, force: true });
    steps.esquina = await callFn("recompute-corner-detection",  { building_id: bid, force: true });
    steps.escs    = await callFn("recount-escaleras",           { building_id: bid, force: true });
    steps.facade  = await callFn("recount-windows-cal5",        { building_id: bid, force: true });
    steps.proteccion = await callFn("check-proteccion-pgou",    { building_id: bid, force: true });
    steps.score   = await callFn("recompute-cluster-scoring",   { building_id: bid });

    // marcar como reprocesado
    const { data: ba } = await sb.from("building_analysis").select("metricas_extra").eq("building_id", bid).maybeSingle();
    const mx = { ...(((ba as any)?.metricas_extra) ?? {}), reprocess_frozen_v1: true, reprocess_frozen_at: new Date().toISOString() };
    await sb.from("building_analysis").update({ metricas_extra: mx }).eq("building_id", bid);

    results.push({ building_id: bid, steps: Object.fromEntries(Object.entries(steps).map(([k,v]) => [k, (v as any).ok])) });
  }

  // Self-reinvoke si quedan
  if (remaining > 0 || ids.length > batch.length) {
    fetch(`${SUPABASE_URL}/functions/v1/reprocess-cohort-77`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ batch: BATCH }),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, processed: batch.length, queue_remaining_aprox: remaining, results }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});