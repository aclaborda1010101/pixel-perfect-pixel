// eval-facade-v2: itera los 6 edificios con GT y mide la variante
// fachada-v2-multicaptura contra facade_window_ground_truth. NO promociona
// la activa salvo que MAPE <= 10% sobre los 6 GT.
// Trocea con auto-reinvocación (1 edificio por invocación, timeout 150s).

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const KEY_STATE = "facade_v2_eval";
const KEY_ACTIVE = "facade_active_variant";
const TARGET_MAPE = 10.0;

async function getSetting(sb: any, key: string) {
  const { data } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(sb: any, key: string, value: any) {
  await sb.from("app_settings").upsert({ key, value }, { onConflict: "key" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  const sb = getServiceClient();
  const body = await req.json().catch(() => ({}));
  const reset = !!body?.reset;
  const force = !!body?.force;

  // 1) GT pool (6 buildings)
  const { data: gtRows, error: gtErr } = await sb
    .from("facade_window_ground_truth")
    .select("building_id, human_count");
  if (gtErr) return err(gtErr.message, 500);
  const gt = new Map<string, number>();
  for (const r of gtRows ?? []) gt.set(r.building_id, Number(r.human_count));
  const gtIds = Array.from(gt.keys());

  // 2) state
  let state: any = await getSetting(sb, KEY_STATE);
  if (reset || !state || !Array.isArray(state.results)) {
    state = {
      variant: "fachada-v2-multicaptura",
      started_at: new Date().toISOString(),
      results: [],
      done: false,
      in_progress: true,
      n_total: gtIds.length,
    };
    await setSetting(sb, KEY_STATE, state);
  }

  const measuredIds = new Set((state.results as any[]).map((r) => r.building_id));
  const pending = gtIds.filter((id) => !measuredIds.has(id));

  if (pending.length === 0) {
    // compute final mape and decide promotion
    const valid = (state.results as any[]).filter((r) => Number.isFinite(Number(r.total)));
    let mape: number | null = null;
    if (valid.length > 0) {
      const errs = valid.map((r) => Math.abs(Number(r.total) - Number(r.gt)) * 100 / Number(r.gt));
      mape = Math.round((errs.reduce((s, e) => s + e, 0) / errs.length) * 10) / 10;
    }
    const active_prev = await getSetting(sb, KEY_ACTIVE);
    let promoted = false;
    let decision = "";
    if (mape !== null && mape <= TARGET_MAPE && valid.length === gtIds.length) {
      await setSetting(sb, `${KEY_ACTIVE}_prev`, active_prev ?? "cal5");
      await setSetting(sb, KEY_ACTIVE, "fachada-v2-multicaptura");
      promoted = true;
      decision = `promoted: MAPE=${mape}% <= ${TARGET_MAPE}%`;
    } else {
      decision = mape === null
        ? `not_promoted: no_valid_measurements`
        : `not_promoted: MAPE=${mape}% > ${TARGET_MAPE}% (valid=${valid.length}/${gtIds.length}). Active stays ${active_prev ?? "cal5"}.`;
    }
    state.done = true;
    state.in_progress = false;
    state.mape = mape;
    state.promoted = promoted;
    state.decision = decision;
    state.finished_at = new Date().toISOString();
    await setSetting(sb, KEY_STATE, state);
    return json({ ok: true, done: true, mape, decision, results: state.results, promoted }, 200);
  }

  // 3) process next building (1 per invocation)
  const nextId = pending[0];
  const tStart = Date.now();
  let result: any = null;
  let credits_exhausted = false;
  try {
    const inv = await sb.functions.invoke("count-facade-windows-v2", {
      body: { building_id: nextId, force },
    });
    if (inv.error) {
      result = { building_id: nextId, gt: gt.get(nextId), total: null, needs_review: true, error: String(inv.error.message ?? inv.error) };
      if (/402|credits/i.test(String(inv.error.message ?? ""))) credits_exhausted = true;
    } else {
      const d = inv.data as any;
      if (d?.status === 402 || d?.error === "ai_credits_exhausted") {
        credits_exhausted = true;
        result = { building_id: nextId, gt: gt.get(nextId), total: null, needs_review: true, error: "402_credits_exhausted" };
      } else {
        result = {
          building_id: nextId,
          gt: gt.get(nextId),
          total: d?.total ?? null,
          needs_review: !!d?.needs_review,
          per_facade: d?.per_facade ?? null,
          flags: d?.flags ?? [],
          elapsed_ms: Date.now() - tStart,
        };
      }
    }
  } catch (e) {
    result = { building_id: nextId, gt: gt.get(nextId), total: null, needs_review: true, error: String((e as Error).message ?? e) };
  }

  state.results.push(result);
  state.last_progress = new Date().toISOString();
  state.remaining = pending.length - 1;
  await setSetting(sb, KEY_STATE, state);

  if (credits_exhausted) {
    state.in_progress = false;
    state.error_402 = true;
    state.decision = "halted: ai_credits_exhausted (402). Active variant unchanged.";
    await setSetting(sb, KEY_STATE, state);
    return json({ ok: false, error: "ai_credits_exhausted", status: 402, partial: state.results }, 402);
  }

  // auto-reinvoke for next pending
  if (state.remaining > 0) {
    sb.functions.invoke("eval-facade-v2", { body: { force } }).catch(() => {});
  } else {
    // recursive finalize
    sb.functions.invoke("eval-facade-v2", { body: {} }).catch(() => {});
  }

  return json({
    ok: true,
    processed: nextId,
    result,
    remaining: state.remaining,
    progress: `${state.results.length}/${gtIds.length}`,
  }, 200);
});