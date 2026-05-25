import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { phase, cursor, job_id } = await req.json();
    if (!["catastro", "google", "vision", "full"].includes(phase)) {
      return err("phase debe ser catastro|google|vision|full", 400);
    }
    const sb = getServiceClient();

    // Crea o continúa job
    let jid = job_id as string | undefined;
    if (!jid) {
      const { data: nj } = await sb.from("scoring_v2_jobs").insert({
        phase, status: "running",
      }).select("id").single();
      jid = nj?.id;
    }

    // Selecciona buildings candidatos
    let q = sb.from("buildings").select("id").order("id");
    if (cursor) q = q.gt("id", cursor);
    const { data: list } = await q.limit(BATCH_SIZE);
    const rows = list ?? [];

    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const auth = {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    };

    const phaseFn = {
      catastro: "fetch-catastro-data",
      google: "fetch-google-imagery",
      vision: "analyze-building-vision",
      full: "process-building-full",
    }[phase];

    let processed = 0;
    let failed = 0;
    for (const b of rows) {
      try {
        const r = await fetch(`${base}/${phaseFn}`, {
          method: "POST", headers: auth, body: JSON.stringify({ building_id: b.id }),
        });
        if (!r.ok) failed++; else processed++;
      } catch {
        failed++;
      }
    }

    const next_cursor = rows.length > 0 ? rows[rows.length - 1].id : null;
    const has_more = rows.length === BATCH_SIZE;

    await sb.from("scoring_v2_jobs").update({
      processed: (await sb.from("scoring_v2_jobs").select("processed").eq("id", jid).single()).data!.processed + processed,
      failed: (await sb.from("scoring_v2_jobs").select("failed").eq("id", jid).single()).data!.failed + failed,
      cursor: next_cursor,
      status: has_more ? "running" : "done",
      finished_at: has_more ? null : new Date().toISOString(),
    }).eq("id", jid);

    return json({ job_id: jid, processed, failed, has_more, next_cursor });
  } catch (e) {
    console.error("batch-pipeline-scoring-v2 error", e);
    return err(String((e as Error).message ?? e));
  }
});