// Procesa en background todos los edificios de "Mi cartera" del usuario
// (asignados activos + cartera_demo_seed). Llama a process-building-full
// por cada edificio con concurrencia controlada. Devuelve inmediatamente
// {status:"queued", total} para no chocar con el timeout de 150s.

import { corsHeaders, err, getServiceClient, json, sleep } from "../_shared/scoring_v2_common.ts";

const CONCURRENCY = 2;
// Cuántos edificios procesa un único invoke antes de re-invocarse a sí mismo.
// process-building-full puede tardar ~60-120s por edificio (catastro + visión + scoring),
// así que con CONCURRENCY=2 mantenemos cada ciclo por debajo del wall-time del edge runtime.
const CHUNK_SIZE = 6;

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

// Auto-reinvoca la función con el resto de la cola para drenarla por ciclos.
async function selfInvoke(remaining: string[], force: boolean, runId: string, onlyMissing: boolean) {
  if (!remaining.length) {
    console.log(`[batch ${runId}] drain complete`);
    return;
  }
  const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
  try {
    const r = await fetch(`${base}/batch-process-cartera`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        building_ids: remaining,
        force,
        only_missing: onlyMissing,
        _continuation_of: runId,
      }),
    });
    console.log(`[batch ${runId}] self-invoke status`, r.status, "remaining=", remaining.length);
  } catch (e) {
    console.error(`[batch ${runId}] self-invoke fail`, String((e as Error).message ?? e));
  }
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

    const runId = (body._continuation_of as string | undefined) ?? crypto.randomUUID().slice(0, 8);

    // Divide la cola en un chunk para este invoke + el resto que se procesará por re-invocación.
    const chunk = ids.slice(0, CHUNK_SIZE);
    const remaining = ids.slice(CHUNK_SIZE);

    const work = (async () => {
      await runBatch(chunk, force, runId);
      // Re-invoca con el resto para drenar la cola sin depender de un único wall-time.
      await selfInvoke(remaining, force, runId, onlyMissing);
    })();

    // @ts-ignore — Deno EdgeRuntime API
    if (typeof EdgeRuntime !== "undefined" && (EdgeRuntime as any).waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      work;
    }

    return json({
      status: "queued",
      total: ids.length,
      chunk: chunk.length,
      remaining: remaining.length,
      run_id: runId,
      concurrency: CONCURRENCY,
      chunk_size: CHUNK_SIZE,
    });
  } catch (e) {
    console.error("batch-process-cartera error", e);
    return err(String((e as Error).message ?? e));
  }
});