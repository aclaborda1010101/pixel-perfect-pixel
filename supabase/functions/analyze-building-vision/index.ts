import { corsHeaders, err, getServiceClient, json, setProcessingStatus, sleep } from "../_shared/scoring_v2_common.ts";

function buildPrompt(numPlantasPages: number) {
  return `Eres un experto en análisis arquitectónico inmobiliario en Madrid.

Te paso las imágenes en este ORDEN (importante):
- Página 1: vista general de la parcela (planta cenital con altura -I+V indicada y mini-foto de fachada).
- Página 2: planta BAJA (accesos comunes, locales, portal).
- Página 3: PISO 01 — primera planta real. AQUÍ se cuentan las cajas de escalera (códigos ESC) y los patios.
- Páginas 4-${Math.max(4, numPlantasPages - 2)}: pisos tipo (PISO 02, 03, 04…).
- Última página de plantas: SÓTANO (si existe; mira código AAL, garajes).
- Después: 4 fotos de Street View de la fachada.
- Después: foto satélite cenital y satélite oblicua.

CONVENCIONES de etiquetas en el plano catastral (CLAVE):
- ESC = caja de escaleras. En PISO 01 cuenta cuántas ESC distintas hay; si son 2 no comunicadas espacialmente → 2 escaleras (apto cambio uso hotelero según normativa Madrid). En planta baja la escalera suele comunicar accesos comunes y NO es indicador fiable.
- VA, VB, VC, VD, ... = viviendas individuales por planta. El máximo de VX en un piso tipo × nº plantas tipo aproxima el total real de viviendas.
- P01, P02, P03, P04 = patios interiores (presentes en todas las plantas).
- TZ, TZAA, TZAB, TZ01, TZ02, TZ03 = terrazas / azoteas transitables (planta superior).
- ACCES01, ACCES02 = accesos comunes (planta baja).
- CCE = local comercial; GC = garaje (planta baja → terciario).
- AAL = almacén / trastero (sótano).

IMPORTANTE — AUDITABILIDAD: para cada métrica que devuelvas, también incluye un bloque metricas_detalle.<nombre_metrica> con:
  value: el valor (number/boolean/array)
  source: array con códigos de fuentes utilizadas. Valores permitidos:
    "catastro_pdf_general", "catastro_pdf_pb", "catastro_pdf_piso_01", "catastro_pdf_piso_02", "catastro_pdf_sotano",
    "street_view_heading_0", "street_view_heading_90", "street_view_heading_180", "street_view_heading_270",
    "satellite", "oblique", "dnprc_json", "calculated_from_ancho_calle", "inferred_symmetry"
  reasoning: explicación corta en español (1-3 frases) de cómo llegaste a ese valor a partir de las fuentes.
  confidence: 0..1

Devuelve un OBJETO JSON ESTRICTO con esta estructura (sin texto fuera del JSON):
{
  "ventanas_fachada_total": number,
  "ventanas_por_planta": { "1": number, "2": number, ... },
  "patios_detectados": number,
  "patios_codigos": ["P01","P02"],
  "accesos_codigos": ["ACCES01"],
  "n_escaleras_en_piso01": number,
  "n_escaleras_en_planta_baja": number,
  "segundas_escaleras": boolean,                  // true si n_escaleras_en_piso01 >= 2
  "viviendas_por_planta_tipo": number,             // max(VA..VZ) en piso tipo
  "n_locales_planta_baja": number,                 // CCE + GC en BAJA
  "n_almacenes_sotano": number,                    // AAL en SÓTANO
  "tiene_sotano": boolean,
  "tiene_azotea_transitable": boolean,
  "esquina": boolean,
  "protegido_historicamente": boolean,
  "plantas_visibles": number,
  "ancho_calle_estimado_m": number,
  "metricas_extra": { "observaciones": string },
  "metricas_detalle": {
    "ventanas_fachada_total": { "value": 28, "source": ["street_view_heading_0","satellite"], "reasoning": "...", "confidence": 0.8 },
    "n_escaleras_en_piso01": { "value": 2, "source": ["catastro_pdf_piso_01"], "reasoning": "...", "confidence": 0.95 },
    "esquina": { "value": true, "source": ["satellite","street_view_heading_0"], "reasoning": "...", "confidence": 0.9 },
    "protegido_historicamente": { "value": true, "source": ["street_view_heading_0"], "reasoning": "...", "confidence": 0.7 }
    // ...incluye una entrada por CADA métrica que devuelvas arriba
  },
  "anotaciones": [
    { "etiqueta": "ESC_1", "tipo": "escalera", "bbox": [x,y,w,h], "descripcion": "caja escaleras central en PISO 01" },
    { "etiqueta": "P01", "tipo": "patio", "bbox": [x,y,w,h], "descripcion": "patio interior" },
    { "etiqueta": "fachada_principal", "tipo": "fachada", "bbox": [x,y,w,h] }
  ],
  "confidence": number  // 0..1
}

IMPORTANTE para "anotaciones": coordenadas RELATIVAS al PISO 01 (la 3ª imagen si está disponible), valores 0..1. bbox = [x, y, ancho, alto] esquina superior izquierda. Si no puedes anotar, devuelve [].
Si una métrica no es deducible, usa null y baja confidence. SIEMPRE incluye reasoning en español, no en inglés.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { building_id, model_override } = await req.json();
    if (!building_id) return err("building_id requerido", 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return err("LOVABLE_API_KEY no disponible", 500);

    const sb = getServiceClient();
    await setProcessingStatus(building_id, "vision", "running");

    // Ejecuta el análisis en segundo plano para evitar el timeout de 150s.
    // El cliente debe sondear processing_status / building_analysis.
    // @ts-ignore EdgeRuntime global proporcionado por Supabase
    EdgeRuntime.waitUntil(runVisionAnalysis(sb, building_id, model_override, LOVABLE_API_KEY));
    return json({ status: "processing", building_id }, 202);
  } catch (e) {
    console.error("analyze-building-vision error", e);
    return err(String((e as Error).message ?? e));
  }
});

async function runVisionAnalysis(sb: any, building_id: string, model_override: string | undefined, LOVABLE_API_KEY: string) {
  const startedAt = Date.now();
  try {

    // Recoge URLs públicas
    const { data: cat } = await sb
      .from("catastro_data")
      .select("plano_url, refcatastral, plantas_pages_urls, plantas_num_pages, plantas_pdf_disponible")
      .eq("building_id", building_id).maybeSingle();
    const { data: imgs } = await sb
      .from("building_imagery").select("source, public_url, heading").eq("building_id", building_id);

    const imageUrls: string[] = [];
    // 1) Páginas del PDF de distribución por plantas (PISO 01 = página 3 idealmente)
    const plantasPages: string[] = Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : [];
    plantasPages.forEach((u) => imageUrls.push(u));
    // 2) Fallback: si no hay PNGs de plantas, el croquis SVG
    if (plantasPages.length === 0 && cat?.plano_url) imageUrls.push(cat.plano_url);
    // 3) Street View + satélite
    (imgs ?? []).forEach((i: any) => imageUrls.push(i.public_url));

    if (imageUrls.length === 0) {
      await setProcessingStatus(building_id, "vision", "error", "sin imágenes para analizar");
      return;
    }

    const PROMPT = buildPrompt(plantasPages.length || 1);

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
    const primaryModel = model_override || "google/gemini-3.5-flash";
    let modelo_usado = primaryModel;
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
          body: JSON.stringify(buildPayload(primaryModel)),
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

    // Fallback si parsed null o confidence baja (no aplicar si ya se forzó modelo premium)
    if (!model_override && (!parsed || (typeof parsed?.confidence === "number" && parsed.confidence < 0.6))) {
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
        analysis_duration_ms: Date.now() - startedAt,
      }, { onConflict: "building_id" });
      await setProcessingStatus(building_id, "vision", "error", lastErr ?? "sin resultado");
      return;
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
      segundas_escaleras: parsed.segundas_escaleras ?? (
        typeof parsed.n_escaleras_en_piso01 === "number" ? parsed.n_escaleras_en_piso01 >= 2 : null
      ),
      esquina: parsed.esquina ?? null,
      protegido_historicamente: parsed.protegido_historicamente ?? null,
      plantas_visibles: plantasVis,
      plantas_max_normativa: plantas_max,
      plantas_levantables: levantables,
      metricas_extra: parsed.metricas_extra ?? null,
      anotaciones_plano: Array.isArray(parsed.anotaciones) ? parsed.anotaciones : null,
      n_escaleras_en_piso01: parsed.n_escaleras_en_piso01 ?? null,
      n_escaleras_en_planta_baja: parsed.n_escaleras_en_planta_baja ?? null,
      viviendas_por_planta_tipo: parsed.viviendas_por_planta_tipo ?? null,
      n_locales_planta_baja: parsed.n_locales_planta_baja ?? null,
      n_almacenes_sotano: parsed.n_almacenes_sotano ?? null,
      tiene_sotano: parsed.tiene_sotano ?? null,
      tiene_azotea_transitable: parsed.tiene_azotea_transitable ?? null,
      patios_codigos: Array.isArray(parsed.patios_codigos) ? parsed.patios_codigos : null,
      accesos_codigos: Array.isArray(parsed.accesos_codigos) ? parsed.accesos_codigos : null,
      modelo_usado,
      modelo_fallback,
      sources_used: {
        plano_svg: !!cat?.plano_url,
        plantas_pdf_pages: plantasPages.length,
        n_imgs_total: imageUrls.length,
      },
      confidence: parsed.confidence ?? null,
      metricas_detalle: parsed.metricas_detalle ?? null,
      llm_raw_response: llm_raw,
      analyzed_at: new Date().toISOString(),
      analyze_error: null,
      analysis_duration_ms: Date.now() - startedAt,
    }, { onConflict: "building_id" });

    // Guarda ancho_calle en catastro_data si lo estimó la IA
    if (cat?.refcatastral && isFinite(anchoEst)) {
      await sb.from("catastro_data")
        .update({ ancho_calle_m: anchoEst })
        .eq("refcatastral", cat.refcatastral);
    }

    // Score se recalcula automáticamente vía trigger; lanzamos enhance-building-score (avisos con reasoning + summary)
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/enhance-building-score`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ building_id }),
      });
    } catch (e) {
      console.warn("enhance-building-score failed (non-fatal)", e);
    }
    const { data: built } = await sb.from("buildings")
      .select("score").eq("id", building_id).maybeSingle();

    await setProcessingStatus(building_id, "vision", "ok");
  } catch (e) {
    console.error("analyze-building-vision background error", e);
    try { await setProcessingStatus(building_id, "vision", "error", String((e as Error).message ?? e)); } catch {}
  }
}