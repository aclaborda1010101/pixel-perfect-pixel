import { corsHeaders, err, getServiceClient, json, sleep } from "../_shared/scoring_v2_common.ts";

// Procesa el resto del CRM (no-cartera-demo) por lotes. Priorización:
//   1) buildings asignados al user
//   2) cartera_demo_seed=true (por si quedó alguno sin procesar)
//   3) top score v1 (proxy: nº viviendas + m²)
//   4) resto
// Filtro: NO existe building_analysis para ese building.
// Idempotente. Concurrencia 2, sleep 2s. Background con waitUntil.

const PHASES = [
  { key: "catastro", fn: "fetch-catastro-data" },
  { key: "google",   fn: "fetch-google-imagery" },
  { key: "vision",   fn: "analyze-building-vision" },
] as const;

const CONCURRENCY = 2;
const SLEEP_BETWEEN_MS = 2000;
const MAX_RETRIES = 3;

async function callFn(fnName: string, body: unknown) {
  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  const r = await fetch(`${base}/${fnName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let parsed: any = null;
  try { parsed = await r.json(); } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, body: parsed };
}

async function callWithRetry(fnName: string, body: unknown) {
  let lastErr = "";
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const r = await callFn(fnName, body);
      if (r.ok) return { ok: true };
      lastErr = `HTTP ${r.status}: ${r.body?.error ?? "fail"}`;
    } catch (e) {
      lastErr = String((e as Error).message ?? e);
    }
    await sleep(2000 * Math.pow(2, attempt));
  }
  return { ok: false, error: lastErr };
}

async function process(jobId: string, limit: number, userId: string | null) {
  const sb = getServiceClient();

  // Cargar ids ya analizados para excluir
  const { data: analyzed } = await sb.from("building_analysis").select("building_id");
  const analyzedIds = new Set((analyzed ?? []).map((r: any) => r.building_id));

  // Asignados al user (prioridad 1)
  let assignedIds: string[] = [];
  if (userId) {
    const { data } = await sb.from("building_assignments")
      .select("building_id").eq("user_id", userId).eq("status", "active");
    assignedIds = (data ?? []).map((r: any) => r.building_id);
  }

  // Demo seed (prioridad 2)
  const { data: demo } = await sb.from("buildings")
    .select("id, direccion").eq("cartera_demo_seed", true);
  const demoIds = (demo ?? []).map((r: any) => r.id);

  // Resto ordenado por score_v1 proxy (num_viviendas desc, m2 desc) — usamos la vista
  const { data: ranked } = await (sb.from("v_building_score" as any) as any)
    .select("id, direccion, num_viviendas, m2_total")
    .order("score", { ascending: false })
    .limit(2000);

  const seen = new Set<string>();
  const ordered: { id: string; direccion: string }[] = [];
  const push = (id: string, direccion: string) => {
    if (!id || seen.has(id) || analyzedIds.has(id)) return;
    seen.add(id);
    ordered.push({ id, direccion });
  };
  for (const id of assignedIds) {
    const row = (ranked ?? []).find((r: any) => r.id === id);
    push(id, row?.direccion ?? "");
  }
  for (const r of demo ?? []) push(r.id, r.direccion ?? "");
  for (const r of ranked ?? []) push(r.id, r.direccion ?? "");

  const items = ordered.slice(0, limit).map((b) => ({
    building_id: b.id, direccion: b.direccion, status: "pending" as const,
  }));

  await sb.from("scoring_v2_jobs").update({
    total: items.length,
    items_status: items,
    phase_progress: Object.fromEntries(PHASES.map(p => [p.key, { ok: 0, failed: 0 }])),
    current_phase: "starting",
  }).eq("id", jobId);

  // Pipeline por item (más sencillo: cada building hace A→B→C→D end-to-end)
  let ok = 0, failed = 0;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    for (const it of chunk) (it as any).status = "running";
    await sb.from("scoring_v2_jobs").update({ items_status: items }).eq("id", jobId);

    await Promise.allSettled(chunk.map(async (it) => {
      try {
        for (const ph of PHASES) {
          await sb.from("scoring_v2_jobs").update({ current_phase: ph.key }).eq("id", jobId);
          const r = await callWithRetry(ph.fn, { building_id: it.building_id });
          if (!r.ok) throw new Error(`${ph.key}: ${r.error}`);
        }
        // Usar la RPC v2 (compute_cluster_score); compute_score (v1) está DEPRECATED
        // y daba una fórmula distinta (sin IEE ni cluster), causando scores incoherentes.
        await sb.rpc("compute_cluster_score", { p_building_id: it.building_id });
        await callFn("enhance-building-score", { building_id: it.building_id });
        (it as any).status = "ok"; ok++;
      } catch (e) {
        (it as any).status = "error"; (it as any).error = String((e as Error).message ?? e); failed++;
      }
    }));

    await sb.from("scoring_v2_jobs").update({
      items_status: items, processed: ok, failed,
    }).eq("id", jobId);
    await sleep(SLEEP_BETWEEN_MS);
  }

  await sb.from("scoring_v2_jobs").update({
    status: "done", current_phase: "done", processed: ok, failed,
    finished_at: new Date().toISOString(),
  }).eq("id", jobId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const sb = getServiceClient();
    const body = await req.json().catch(() => ({} as any));
    const limit = Math.max(1, Math.min(500, Number(body?.limit ?? 100)));
    const userId = body?.user_id ?? null;

    const { data: job, error: jErr } = await sb.from("scoring_v2_jobs").insert({
      kind: "auto_pending",
      phase: "auto_pending",
      status: "running",
      current_phase: "starting",
    }).select("id").single();
    if (jErr || !job) return err("No se pudo crear el job: " + (jErr?.message ?? ""), 500);

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(process(job.id, limit, userId).catch(async (e) => {
      console.error("process pending fatal", e);
      await sb.from("scoring_v2_jobs").update({
        status: "aborted", error: String((e as Error).message ?? e),
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);
    }));

    return json({ job_id: job.id, status: "started", limit });
  } catch (e) {
    console.error("auto-process-pending-buildings error", e);
    return err(String((e as Error).message ?? e));
  }
});