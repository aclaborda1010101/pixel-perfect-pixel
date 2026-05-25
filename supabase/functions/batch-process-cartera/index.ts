// Procesa en background todos los edificios de "Mi cartera" del usuario
// (asignados activos + cartera_demo_seed). Llama a process-building-full
// por cada edificio con concurrencia controlada. Devuelve inmediatamente
// {status:"queued", total} para no chocar con el timeout de 150s.

import { corsHeaders, err, getServiceClient, json, sleep } from "../_shared/scoring_v2_common.ts";

const CONCURRENCY = 2;

async function processOne(building_id: string, force: boolean) {
  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  const auth = {
    Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    "Content-Type": "application/json",
  };
  try {
    const r = await fetch(`${base}/process-building-full`, {
      method: "POST", headers: auth, body: JSON.stringify({ building_id, force }),
    });
    const j = await r.json().catch(() => ({}));
    console.log("[batch] done", building_id, j?.status ?? r.status);
  } catch (e) {
    console.warn("[batch] fail", building_id, String((e as Error).message ?? e));
  }
}

async function runBatch(ids: string[], force: boolean, runId: string) {
  console.log(`[batch ${runId}] starting`, ids.length, "edificios, conc=", CONCURRENCY);
  let idx = 0;
  const workers: Promise<void>[] = [];
  for (let c = 0; c < CONCURRENCY; c++) {
    workers.push((async () => {
      while (true) {
        const i = idx++;
        if (i >= ids.length) break;
        await processOne(ids[i], force);
        await sleep(500); // suaviza ráfaga al Catastro
      }
    })());
  }
  await Promise.all(workers);
  console.log(`[batch ${runId}] complete`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.user_id as string | undefined;
    const onlyMissing = body.only_missing !== false; // default true
    const force = !!body.force;
    const explicit = Array.isArray(body.building_ids) ? body.building_ids as string[] : null;

    const sb = getServiceClient();

    let ids: string[] = [];
    if (explicit && explicit.length) {
      ids = explicit;
    } else {
      // demo seed
      const { data: demo } = await sb.from("buildings").select("id").eq("cartera_demo_seed", true);
      const demoIds = (demo ?? []).map((r: any) => r.id);
      // asignados al user (si se pasa)
      let assignedIds: string[] = [];
      if (userId) {
        const { data: a } = await sb.from("building_assignments")
          .select("building_id").eq("user_id", userId).eq("status", "active");
        assignedIds = (a ?? []).map((r: any) => r.building_id);
      }
      ids = Array.from(new Set([...demoIds, ...assignedIds]));
    }

    if (onlyMissing && !force) {
      const { data: done } = await sb.from("building_analysis")
        .select("building_id").in("building_id", ids);
      const haveSet = new Set((done ?? []).map((r: any) => r.building_id));
      ids = ids.filter((id) => !haveSet.has(id));
    }

    if (!ids.length) return json({ status: "nothing_to_do", total: 0 });

    const runId = crypto.randomUUID().slice(0, 8);

    // @ts-ignore — Deno EdgeRuntime API
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(runBatch(ids, force, runId));
    } else {
      // Fallback: dispara y olvida
      runBatch(ids, force, runId);
    }

    return json({ status: "queued", total: ids.length, run_id: runId, concurrency: CONCURRENCY });
  } catch (e) {
    console.error("batch-process-cartera error", e);
    return err(String((e as Error).message ?? e));
  }
});