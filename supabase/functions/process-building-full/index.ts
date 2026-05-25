import { corsHeaders, err, json } from "../_shared/scoring_v2_common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { building_id, force } = await req.json();
    if (!building_id) return err("building_id requerido", 400);

    const base = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
    const auth = {
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    };

    const steps: Array<{ name: string; res?: any; error?: string }> = [];

    // 1. Catastro
    try {
      const r = await fetch(`${base}/fetch-catastro-data`, {
        method: "POST", headers: auth, body: JSON.stringify({ building_id, force }),
      });
      const j = await r.json();
      steps.push({ name: "catastro", res: j });
      if (!r.ok) throw new Error(j?.error ?? "catastro fail");
    } catch (e) {
      steps.push({ name: "catastro", error: String((e as Error).message ?? e) });
      return json({ status: "failed_catastro", steps }, 200);
    }

    // 2. Google Imagery
    try {
      const r = await fetch(`${base}/fetch-google-imagery`, {
        method: "POST", headers: auth, body: JSON.stringify({ building_id }),
      });
      const j = await r.json();
      steps.push({ name: "google", res: j });
      if (!r.ok) throw new Error(j?.error ?? "google fail");
    } catch (e) {
      steps.push({ name: "google", error: String((e as Error).message ?? e) });
      // continúa al análisis aunque falle imagery — el plano puede ser suficiente
    }

    // 3. Vision
    try {
      const r = await fetch(`${base}/analyze-building-vision`, {
        method: "POST", headers: auth, body: JSON.stringify({ building_id }),
      });
      const j = await r.json();
      steps.push({ name: "vision", res: j });
      if (!r.ok) throw new Error(j?.error ?? "vision fail");
      return json({ status: "ok", score: j.score, steps });
    } catch (e) {
      steps.push({ name: "vision", error: String((e as Error).message ?? e) });
      return json({ status: "failed_vision", steps }, 200);
    }
  } catch (e) {
    console.error("process-building-full error", e);
    return err(String((e as Error).message ?? e));
  }
});