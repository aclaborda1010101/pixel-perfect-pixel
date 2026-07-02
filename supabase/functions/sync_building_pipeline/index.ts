// Orquestador único de sincronización de edificios.
// Encadena secuencialmente: catastro → geometry → google → corner → proteccion → iee → score → cluster.
// - Idempotente: cada fase se salta si el dato es "fresco" (<FRESH_DAYS) salvo force=true.
// - Concurrencia máx 2 edificios, timeout por fase, si una fase falla se registra y continúa.
// - Estado persistido en building_processing_status (phases jsonb) y scoring_v2_jobs (items_status/phase_progress).

import { corsHeaders, getServiceClient, json, err } from "../_shared/scoring_v2_common.ts";

const FRESH_DAYS = 7;
const FRESH_MS = FRESH_DAYS * 24 * 3600 * 1000;
const CONCURRENCY = 2;
const PHASE_TIMEOUT_MS = 120_000; // 2 min por fase

type PhaseId =
  | "catastro"
  | "geometry"
  | "google"
  | "corner"
  | "proteccion"
  | "iee"
  | "score"
  | "cluster";

const PHASES: { id: PhaseId; fn: string; body: (bid: string, force: boolean) => Record<string, unknown> }[] = [
  { id: "catastro",   fn: "fetch-catastro-data",         body: (bid, f) => ({ building_id: bid, force: f }) },
  { id: "geometry",   fn: "recompute-parcel-geometry",   body: (bid, f) => ({ building_id: bid, force: f }) },
  { id: "google",     fn: "fetch-google-imagery",        body: (bid)    => ({ building_id: bid }) },
  { id: "corner",     fn: "recompute-corner-detection",  body: (bid)    => ({ building_ids: [bid] }) },
  { id: "proteccion", fn: "check-proteccion-pgou",       body: (bid)    => ({ building_id: bid }) },
  { id: "iee",        fn: "fetch_iee_madrid",            body: (bid)    => ({ building_id: bid }) },
  { id: "score",      fn: "enhance-building-score",      body: (bid)    => ({ building_id: bid }) },
  { id: "cluster",    fn: "recompute-cluster-scoring",   body: (bid)    => ({ only_seed: false, building_ids: [bid], limit: 1 }) },
];

function isFresh(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) < FRESH_MS;
}

async function fetchFreshnessSnapshot(sb: ReturnType<typeof getServiceClient>, bid: string) {
  const [b, ba, cd, imgs, geo] = await Promise.all([
    sb.from("buildings").select("refcatastral, score_updated_at, iee_actualizado_at, cluster_score").eq("id", bid).maybeSingle(),
    sb.from("building_analysis").select("updated_at, proteccion_source, esquina_visor_confianza, es_esquina_visor").eq("building_id", bid).maybeSingle(),
    sb.from("catastro_data").select("updated_at").eq("building_id", bid).maybeSingle(),
    sb.from("building_imagery").select("fetched_at").eq("building_id", bid).order("fetched_at", { ascending: false }).limit(1),
    null,
  ]);
  const rc14 = (b.data?.refcatastral ?? "").slice(0, 14);
  let geoUpdated: string | null = null;
  if (rc14) {
    const { data } = await sb.from("parcel_geometry_cache").select("updated_at").eq("refcatastral_14", rc14).maybeSingle();
    geoUpdated = data?.updated_at ?? null;
  }
  return {
    catastro:   isFresh(cd.data?.updated_at) && !!b.data?.refcatastral,
    geometry:   isFresh(geoUpdated),
    google:     Array.isArray(imgs.data) && imgs.data.length > 0 && isFresh(imgs.data[0]?.fetched_at),
    corner:     isFresh(ba.data?.updated_at) && (ba.data?.esquina_visor_confianza != null || ba.data?.es_esquina_visor != null),
    proteccion: isFresh(ba.data?.updated_at) && !!ba.data?.proteccion_source,
    iee:        isFresh(b.data?.iee_actualizado_at),
    score:      isFresh(b.data?.score_updated_at),
    cluster:    isFresh(b.data?.score_updated_at) && b.data?.cluster_score != null,
  } as Record<PhaseId, boolean>;
}

async function invokeWithTimeout(fnName: string, body: Record<string, unknown>, ms = PHASE_TIMEOUT_MS): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fnName}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: true, data: text }; }
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `timeout ${ms}ms` : (e?.message ?? String(e));
    return { ok: false, error: msg };
  } finally {
    clearTimeout(to);
  }
}

type ItemState = {
  building_id: string;
  direccion?: string | null;
  status: "pending" | "running" | "ok" | "error";
  phase?: string;
  error?: string | null;
};

async function persistJobState(sb: ReturnType<typeof getServiceClient>, jobId: string, items: ItemState[], phaseProgress: Record<string, { ok: number; failed: number }>, currentPhase: string | null) {
  const processed = items.filter(i => i.status === "ok" || i.status === "error").length;
  const failed = items.filter(i => i.status === "error").length;
  await sb.from("scoring_v2_jobs").update({
    items_status: items as any,
    phase_progress: phaseProgress as any,
    current_phase: currentPhase,
    processed,
    failed,
  }).eq("id", jobId);
}

async function processBuilding(
  sb: ReturnType<typeof getServiceClient>,
  bid: string,
  force: boolean,
  onPhase: (phase: PhaseId, status: "running" | "ok" | "error" | "skipped", error?: string) => Promise<void>,
): Promise<void> {
  const fresh = force ? ({} as Record<PhaseId, boolean>) : await fetchFreshnessSnapshot(sb, bid);
  const phasesState: Record<string, { status: string; error?: string | null; at: string }> = {};

  await sb.from("building_processing_status").upsert({
    building_id: bid,
    pipeline_stage: "starting",
    status: "running",
    started_at: new Date().toISOString(),
    finished_at: null,
    error: null,
    phases: phasesState as any,
    updated_at: new Date().toISOString(),
  });

  for (const p of PHASES) {
    if (!force && fresh[p.id]) {
      phasesState[p.id] = { status: "skipped", at: new Date().toISOString() };
      await onPhase(p.id, "skipped");
      continue;
    }
    await onPhase(p.id, "running");
    phasesState[p.id] = { status: "running", at: new Date().toISOString() };
    await sb.from("building_processing_status").update({
      pipeline_stage: p.id,
      phases: phasesState as any,
      updated_at: new Date().toISOString(),
    }).eq("building_id", bid);

    const res = await invokeWithTimeout(p.fn, p.body(bid, force));
    if (res.ok) {
      phasesState[p.id] = { status: "ok", at: new Date().toISOString() };
      await onPhase(p.id, "ok");
    } else {
      phasesState[p.id] = { status: "error", error: res.error ?? "unknown", at: new Date().toISOString() };
      await onPhase(p.id, "error", res.error);
      // continuamos con las siguientes fases: son independientes salvo que dependan del dato base
    }
    await sb.from("building_processing_status").update({
      phases: phasesState as any,
      updated_at: new Date().toISOString(),
    }).eq("building_id", bid);
  }

  const anyErr = Object.values(phasesState).some((v) => v.status === "error");
  await sb.from("building_processing_status").update({
    pipeline_stage: "done",
    status: anyErr ? "error" : "ok",
    finished_at: new Date().toISOString(),
    error: anyErr ? "Algunas fases fallaron" : null,
    phases: phasesState as any,
    updated_at: new Date().toISOString(),
  }).eq("building_id", bid);
}

async function runJob(jobId: string, buildingIds: string[], force: boolean) {
  const sb = getServiceClient();
  // Cargar direcciones para el UI
  const { data: rows } = await sb.from("buildings").select("id, direccion").in("id", buildingIds);
  const dirMap = new Map<string, string | null>((rows ?? []).map((r: any) => [r.id, r.direccion]));

  const items: ItemState[] = buildingIds.map((id) => ({
    building_id: id,
    direccion: dirMap.get(id) ?? null,
    status: "pending",
  }));
  const phaseProgress: Record<string, { ok: number; failed: number }> = {};
  for (const p of PHASES) phaseProgress[p.id] = { ok: 0, failed: 0 };

  await sb.from("scoring_v2_jobs").update({
    status: "running",
    total: buildingIds.length,
    items_status: items as any,
    phase_progress: phaseProgress as any,
    started_at: new Date().toISOString(),
  }).eq("id", jobId);

  let cursor = 0;
  const inFlight = new Set<Promise<void>>();

  const launch = (idx: number) => {
    const bid = buildingIds[idx];
    items[idx].status = "running";
    const p = (async () => {
      try {
        await processBuilding(sb, bid, force, async (phase, status, error) => {
          items[idx].phase = phase;
          if (status === "error") {
            phaseProgress[phase].failed++;
          } else if (status === "ok") {
            phaseProgress[phase].ok++;
          }
          if (Math.random() < 0.35) {
            await persistJobState(sb, jobId, items, phaseProgress, phase);
          }
        });
        const hadErr = items[idx].phase && phaseProgress; // no-op
        // Comprobar si el edificio tuvo algún fallo real
        const { data: st } = await sb.from("building_processing_status").select("status,error").eq("building_id", bid).maybeSingle();
        items[idx].status = st?.status === "error" ? "error" : "ok";
        items[idx].error = st?.error ?? null;
      } catch (e: any) {
        items[idx].status = "error";
        items[idx].error = String(e?.message ?? e).slice(0, 300);
      } finally {
        await persistJobState(sb, jobId, items, phaseProgress, items[idx].phase ?? null);
      }
    })();
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  };

  while (cursor < buildingIds.length || inFlight.size > 0) {
    while (inFlight.size < CONCURRENCY && cursor < buildingIds.length) {
      launch(cursor++);
    }
    if (inFlight.size > 0) {
      await Promise.race(Array.from(inFlight));
    }
  }

  const anyErr = items.some((i) => i.status === "error");
  await sb.from("scoring_v2_jobs").update({
    status: "done",
    finished_at: new Date().toISOString(),
    items_status: items as any,
    phase_progress: phaseProgress as any,
    current_phase: "done",
    processed: items.length,
    failed: items.filter(i => i.status === "error").length,
    error: anyErr ? "Algunos edificios tuvieron fases con error" : null,
  }).eq("id", jobId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const {
      building_ids,
      building_id,
      all_cohort,
      only_stale,
      force,
    } = body as {
      building_ids?: string[];
      building_id?: string;
      all_cohort?: boolean;
      only_stale?: boolean;
      force?: boolean;
    };

    const sb = getServiceClient();
    let ids: string[] = [];
    if (Array.isArray(building_ids) && building_ids.length) ids = building_ids;
    else if (building_id) ids = [building_id];
    else if (all_cohort) {
      const { data } = await sb.from("building_analysis").select("building_id").limit(5000);
      ids = (data ?? []).map((r: any) => r.building_id).filter(Boolean);
    } else {
      return err("Indica building_id, building_ids[] o all_cohort=true", 400);
    }

    if (only_stale && !force) {
      // Filtra rápido: descarta edificios cuyo score se refrescó hace <7 días
      const { data } = await sb.from("buildings").select("id, score_updated_at").in("id", ids);
      const staleIds = new Set(
        (data ?? [])
          .filter((r: any) => !r.score_updated_at || (Date.now() - Date.parse(r.score_updated_at)) > FRESH_MS)
          .map((r: any) => r.id),
      );
      ids = ids.filter((id) => staleIds.has(id));
    }

    if (!ids.length) return json({ ok: true, skip: "nada que sincronizar", ids: [] });

    // Crear job
    const { data: job, error: jobErr } = await sb.from("scoring_v2_jobs").insert({
      kind: "building_pipeline",
      status: "pending",
      total: ids.length,
      current_phase: "starting",
      items_status: [] as any,
      phase_progress: {} as any,
    }).select("id").single();
    if (jobErr || !job) return err(`No pude crear job: ${jobErr?.message}`, 500);

    // @ts-ignore EdgeRuntime existe en Supabase
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(runJob(job.id, ids, !!force));
    } else {
      runJob(job.id, ids, !!force);
    }

    return json({ ok: true, job_id: job.id, total: ids.length, force: !!force });
  } catch (e: any) {
    return err(String(e?.message ?? e), 500);
  }
});