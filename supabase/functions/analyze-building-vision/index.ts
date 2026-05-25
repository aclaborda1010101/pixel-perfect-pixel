import { corsHeaders, err, getServiceClient, json, setProcessingStatus, sleep } from "../_shared/scoring_v2_common.ts";

const PROMPT = `Eres un experto en análisis arquitectónico inmobiliario en Madrid.
Recibes: (1) plano catastral del edificio (vista de planta), (2) foto satélite cenital, (3) foto satélite oblicua, (4) varias fotos de Street View de la fachada.

Analiza y devuelve un OBJETO JSON con esta estructura EXACTA (sin texto fuera del JSON):
{
  "ventanas_fachada_total": number,
  "ventanas_por_planta": { "1": number, "2": number, ... },
  "patios_detectados": number,
  "segundas_escaleras": boolean,
  "esquina": boolean,
  "protegido_historicamente": boolean,
  "plantas_visibles": number,
  "ancho_calle_estimado_m": number,
  "metricas_extra": { "observaciones": string },
  "confidence": number  // 0..1
}
Si una métrica no es deducible, usa null en su campo y baja confidence.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { building_id } = await req.json();
    if (!building_id) return err("building_id requerido", 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return err("LOVABLE_API_KEY no disponible", 500);

    const sb = getServiceClient();
    await setProcessingStatus(building_id, "vision", "running");

    // Recoge URLs públicas
    const { data: cat } = await sb
      .from("catastro_data").select("plano_url, refcatastral")
      .eq("building_id", building_id).maybeSingle();
    const { data: imgs } = await sb
      .from("building_imagery").select("source, public_url, heading").eq("building_id", building_id);

    const imageUrls: string[] = [];
    if (cat?.plano_url) imageUrls.push(cat.plano_url); // SVG; el gateway/modelo puede no leerlo
    (imgs ?? []).forEach((i: any) => imageUrls.push(i.public_url));

    if (imageUrls.length === 0) {
      await setProcessingStatus(building_id, "vision", "error", "sin imágenes para analizar");
      return err("No hay imágenes ni plano para analizar", 400);
    }

    // Construye payload OpenAI-compatible para Lovable AI Gateway
    const buildPayload = (model: string) => ({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      }],
      response_format: { type: "json_object" },
    });

    let parsed: any = null;
    let modelo_usado = "google/gemini-2.5-flash";
    let modelo_fallback = false;
    let llm_raw: any = null;
    let lastErr: string | null = null;

    // Intenta primario hasta 3 veces
    for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildPayload("google/gemini-2.5-flash")),
        });
        if (r.status === 429 || r.status === 402) {
          lastErr = `gateway ${r.status}`;
          await sleep(2000 * (attempt + 1));
          continue;
        }
        const j = await r.json();
        llm_raw = j;
        const txt = j?.choices?.[0]?.message?.content ?? "";
        try { parsed = JSON.parse(txt); } catch { lastErr = "JSON inválido (primario)"; }
      } catch (e) {
        lastErr = String((e as Error).message ?? e);
        await sleep(2000 * (attempt + 1));
      }
    }

    // Fallback si parsed null o confidence baja
    if (!parsed || (typeof parsed?.confidence === "number" && parsed.confidence < 0.6)) {
      modelo_fallback = true;
      modelo_usado = "google/gemini-3.5-flash";
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildPayload("google/gemini-3.5-flash")),
        });
        const j = await r.json();
        llm_raw = j;
        const txt = j?.choices?.[0]?.message?.content ?? "";
        parsed = JSON.parse(txt);
      } catch (e) {
        lastErr = `fallback fail: ${String((e as Error).message ?? e)}`;
      }
    }

    if (!parsed) {
      await sb.from("building_analysis").upsert({
        building_id,
        modelo_usado,
        modelo_fallback,
        llm_raw_response: llm_raw,
        analyze_error: lastErr ?? "sin resultado",
        analyzed_at: new Date().toISOString(),
      }, { onConflict: "building_id" });
      await setProcessingStatus(building_id, "vision", "error", lastErr ?? "sin resultado");
      return err(lastErr ?? "Vision sin resultado", 502);
    }

    // Calcula plantas_levantables
    const anchoEst = Number(parsed.ancho_calle_estimado_m ?? null);
    let plantas_max: number | null = null;
    if (isFinite(anchoEst)) {
      const { data: pm } = await sb.rpc("madrid_plantas_max", { ancho_m: anchoEst });
      plantas_max = (pm as number | null) ?? null;
    }
    const plantasVis = Number(parsed.plantas_visibles ?? 0);
    const levantables = plantas_max ? Math.max(plantas_max - plantasVis, 0) : null;

    await sb.from("building_analysis").upsert({
      building_id,
      ventanas_fachada_total: parsed.ventanas_fachada_total ?? null,
      ventanas_por_planta: parsed.ventanas_por_planta ?? null,
      patios_detectados: parsed.patios_detectados ?? null,
      segundas_escaleras: parsed.segundas_escaleras ?? null,
      esquina: parsed.esquina ?? null,
      protegido_historicamente: parsed.protegido_historicamente ?? null,
      plantas_visibles: plantasVis,
      plantas_max_normativa: plantas_max,
      plantas_levantables: levantables,
      metricas_extra: parsed.metricas_extra ?? null,
      modelo_usado,
      modelo_fallback,
      sources_used: { plano: !!cat?.plano_url, n_imgs: imageUrls.length },
      confidence: parsed.confidence ?? null,
      llm_raw_response: llm_raw,
      analyzed_at: new Date().toISOString(),
      analyze_error: null,
    }, { onConflict: "building_id" });

    // Guarda ancho_calle en catastro_data si lo estimó la IA
    if (cat?.refcatastral && isFinite(anchoEst)) {
      await sb.from("catastro_data")
        .update({ ancho_calle_m: anchoEst })
        .eq("refcatastral", cat.refcatastral);
    }

    // Score se recalcula automáticamente vía trigger
    const { data: built } = await sb.from("buildings")
      .select("score").eq("id", building_id).maybeSingle();

    await setProcessingStatus(building_id, "vision", "ok");
    return json({
      score: built?.score ?? null,
      modelo_usado, modelo_fallback,
      confidence: parsed.confidence ?? null,
    });
  } catch (e) {
    console.error("analyze-building-vision error", e);
    return err(String((e as Error).message ?? e));
  }
});