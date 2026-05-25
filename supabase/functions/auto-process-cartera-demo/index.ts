import { corsHeaders, err, getServiceClient, json, sleep } from "../_shared/scoring_v2_common.ts";

// Orquestador end-to-end para los edificios marcados con cartera_demo_seed=true.
// Ejecuta Fase A (catastro PDF + fallback SVG), B (Google imagery), C (Vision IA), D (compute_score).
// Persiste progreso en scoring_v2_jobs (kind='cartera_demo'). Procesa en background con waitUntil.

const PHASES = [
  { key: "catastro", fn: "fetch-catastro-data" },
  { key: "google",   fn: "fetch-google-imagery" },
  { key: "vision",   fn: "analyze-building-vision" },
] as const;

const CONCURRENCY = 2;
const SLEEP_BETWEEN_MS = 2000;
const MAX_RETRIES = 3;
const ABORT_FAIL_RATIO = 0.5;

type ItemStatus = {
  building_id: string;
  direccion?: string | null;
  status: "pending" | "running" | "ok" | "error";
  phase?: string;
  error?: string | null;
  score?: number | null;
};

async function callFn(fnName: string, body: unknown): Promise<{ ok: boolean; status: number; body: any }> {
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

async function callWithRetry(fnName: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
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

async function processCartera(jobId: string) {
  const sb = getServiceClient();

  // Cargar buildings demo
  const { data: bldgs } = await sb
    .from("buildings")
    .select("id, direccion")
    .eq("cartera_demo_seed", true)
    .order("direccion");
  const items: ItemStatus[] = (bldgs ?? []).map((b: any) => ({
    building_id: b.id, direccion: b.direccion, status: "pending",
  }));

  await sb.from("scoring_v2_jobs").update({
    total: items.length,
    items_status: items,
    phase_progress: Object.fromEntries(PHASES.map(p => [p.key, { ok: 0, failed: 0 }])),
    current_phase: "starting",
  }).eq("id", jobId);

  let aborted = false;

  for (const phase of PHASES) {
    await sb.from("scoring_v2_jobs").update({ current_phase: phase.key }).eq("id", jobId);
    let phaseOk = 0, phaseFail = 0;

    // Procesar en chunks de CONCURRENCY
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      // Marcar running
      for (const it of chunk) { it.status = "running"; it.phase = phase.key; }
      await sb.from("scoring_v2_jobs").update({ items_status: items }).eq("id", jobId);

      const results = await Promise.allSettled(
        chunk.map((it) => callWithRetry(phase.fn, { building_id: it.building_id })),
      );

      for (let k = 0; k < chunk.length; k++) {
        const r = results[k];
        const it = chunk[k];
        if (r.status === "fulfilled" && r.value.ok) {
          it.status = "ok";
          it.error = null;
          phaseOk++;
        } else {
          it.status = "error";
          it.error = r.status === "fulfilled" ? (r.value.error ?? "fail") : String(r.reason);
          phaseFail++;
        }
      }

      await sb.from("scoring_v2_jobs").update({
        items_status: items,
        phase_progress: {
          ...(await getPhaseProgress(jobId)),
          [phase.key]: { ok: phaseOk, failed: phaseFail },
        },
        processed: items.filter(it => it.status === "ok").length,
        failed: items.filter(it => it.status === "error").length,
      }).eq("id", jobId);

      await sleep(SLEEP_BETWEEN_MS);
    }

    // Reset status to pending for next phase (only items that succeeded continue)
    const failRatio = items.length > 0 ? phaseFail / items.length : 0;
    if (failRatio > ABORT_FAIL_RATIO) {
      aborted = true;
      await sb.from("scoring_v2_jobs").update({
        status: "aborted",
        error: `Fase ${phase.key}: ${(failRatio * 100).toFixed(0)}% fallos (>${ABORT_FAIL_RATIO * 100}%)`,
        finished_at: new Date().toISOString(),
      }).eq("id", jobId);
      return;
    }

    // Reset items to pending for next phase, conservando los que fallaron como "error" persistente? 
    // Mejor: continuar solo con los OK; los error quedan marcados.
    for (const it of items) {
      if (it.status === "ok") it.status = "pending";
    }
  }

  if (aborted) return;

  // Fase D: compute_score por cada building (sólo los que no quedaron en error)
  await sb.from("scoring_v2_jobs").update({ current_phase: "score" }).eq("id", jobId);
  let scoreOk = 0;
  for (const it of items) {
    if (it.status === "error") continue;
    try {
      const { data: scoreVal } = await sb.rpc("compute_score", { p_building_id: it.building_id });
      it.status = "ok";
      it.score = scoreVal as any;
      scoreOk++;
    } catch (e) {
      it.status = "error";
      it.error = "score: " + String((e as Error).message ?? e);
    }
    await sb.from("scoring_v2_jobs").update({ items_status: items }).eq("id", jobId);
  }

  await sb.from("scoring_v2_jobs").update({
    status: "done",
    current_phase: "done",
    processed: scoreOk,
    failed: items.filter(it => it.status === "error").length,
    phase_progress: {
      ...(await getPhaseProgress(jobId)),
      score: { ok: scoreOk, failed: items.filter(it => it.status === "error").length },
    },
    items_status: items,
    finished_at: new Date().toISOString(),
  }).eq("id", jobId);
}

async function getPhaseProgress(jobId: string): Promise<Record<string, any>> {
  const sb = getServiceClient();
  const { data } = await sb.from("scoring_v2_jobs").select("phase_progress").eq("id", jobId).single();
  return (data?.phase_progress as any) ?? {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const sb = getServiceClient();

    // Crear job
    const { data: job, error: jErr } = await sb.from("scoring_v2_jobs").insert({
      kind: "cartera_demo",
      phase: "cartera_demo",
      status: "running",
      current_phase: "starting",
    }).select("id").single();

    if (jErr || !job) return err("No se pudo crear el job: " + (jErr?.message ?? ""), 500);

    // @ts-ignore - EdgeRuntime existe en Supabase Edge Functions
    EdgeRuntime.waitUntil(processCartera(job.id).catch(async (e) => {
      console.error("processCartera fatal", e);
      await sb.from("scoring_v2_jobs").update({
        status: "aborted",
        error: String((e as Error).message ?? e),
        finished_at: new Date().toISOString(),
      }).eq("id", job.id);
    }));

    return json({ job_id: job.id, status: "started" });
  } catch (e) {
    console.error("auto-process-cartera-demo error", e);
    return err(String((e as Error).message ?? e));
  }
});