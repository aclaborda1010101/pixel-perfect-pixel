import { corsHeaders, err, getServiceClient, json, setProcessingStatus, sleep } from "../_shared/scoring_v2_common.ts";

function buildPrompt(numPlantasPages: number, planoSource: "fxcc" | "descriptivo" = "descriptivo") {
  const layout = planoSource === "fxcc"
    ? `Te paso las imágenes en este ORDEN (importante):
- Página 1: PLANTA GENERAL del FXCC (huella completa del edificio con códigos de planta -I, P, I, II, III, IV, V… y superficies en m²).
- Páginas 2-${Math.max(2, numPlantasPages)}: UNA página por PLANTA del edificio (sótano, planta baja, plantas tipo I, II, III…), cada una con sus subparcelas etiquetadas por uso (V.A.1, V.B.2, COM.TA, COM.VA, PTO…) y superficies m². ESTOS planos son la fuente PRIMARIA para contar viviendas, locales, almacenes, accesos y patios.
- Después: 4 fotos de Street View de la fachada.
- Después: foto satélite cenital y satélite oblicua.`
    : `Te paso las imágenes en este ORDEN (importante):
- Página 1: vista general de la parcela (planta cenital con altura -I+V indicada y mini-foto de fachada).
- Página 2: planta BAJA (accesos comunes, locales, portal).
- Página 3: PISO 01 — primera planta real. AQUÍ se cuentan las cajas de escalera (códigos ESC) y los patios.
- Páginas 4-${Math.max(4, numPlantasPages - 2)}: pisos tipo (PISO 02, 03, 04…).
- Última página de plantas: SÓTANO (si existe; mira código AAL, garajes).
- Después: 4 fotos de Street View de la fachada.
- Después: foto satélite cenital y satélite oblicua.`;
  return `Eres un experto en análisis arquitectónico inmobiliario en Madrid.

${layout}

CONVENCIONES de etiquetas en el plano catastral (CLAVE):
- ESC = caja de escaleras. REGLA CRÍTICA: el conteo de escaleras del edificio se hace SIEMPRE sobre el plano del **PISO 01 (primera planta tipo)**, NUNCA sobre planta baja, porque en planta baja las escaleras suelen comunicar únicamente accesos comunes/portales y no son indicador fiable. En PISO 01 cuenta cuántas cajas ESC distintas hay; si son 2 o más núcleos verticales no comunicados espacialmente entre sí → segundas_escaleras = true (apto cambio uso hotelero según normativa Madrid, doble vía de evacuación). En metricas_detalle.n_escaleras_en_piso01.reasoning DEBES explicar literalmente: (a) que has mirado el plano del PISO 01, (b) cuántas cajas ESC has localizado y dónde (ej. "una al norte junto al patio P01 y otra al sur en la fachada principal"), (c) si están comunicadas o son independientes.
- VA, VB, VC, VD, ... = viviendas individuales por planta. El máximo de VX en un piso tipo × nº plantas tipo aproxima el total real de viviendas.
- PATIOS: cualquier recinto INTERIOR cerrado SIN TECHO rodeado total o parcialmente por viviendas/muros del propio edificio. Variantes de etiqueta posibles: P01, P02..., P, PI, PT, PTO, PTO1, PTO2, PAT, P-1, "PATIO". OJO: hay patios SIN etiqueta visible — detéctalos también por la forma: hueco interior dentro de la huella del edificio que se repite en todas las plantas tipo. NO confundir con balcones/terrazas exteriores (esos dan a calle).
  REGLA DE CONTEO de patios:
    1) Trabaja sobre el PISO 01 (planta tipo) — los patios son verticales y se repiten.
    2) Cuenta TODOS los huecos interiores cerrados, etiquetados o no.
    3) Cruza con la vista cenital de página 1 y con la foto satélite cenital: los patios aparecen como zonas oscuras/sombras dentro de la huella del edificio.
    4) Devuelve patios_codigos con UNA entrada por patio detectado (si no tiene código, usa "PATIO_1", "PATIO_2"...). patios_detectados DEBE ser igual a la longitud de patios_codigos.
    5) Si hay discrepancia entre PDF y satélite, baja confidence pero usa el valor más alto verosímil.
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
  "fachada_lineal_total_m": number,                 // si puedes estimarla, devuélvela; si no, usa null. No la uses para inferir ventanas a patio.
  "patios_areas_m2": { "P01": number, "PATIO_2": number },  // opcional para auditoría del plano. USA las mismas claves que patios_codigos.
  "paredes_por_patio": { "P01": 4, "P02": 3 },     // número de paredes/lados visibles en planta del patio (típico 3-4 en patios madrileños). USA las mismas claves que patios_codigos.
  "ventanas_patios_total": number,                 // si no puedes contarlas visualmente, devuelve una estimación prudente. El backend recalibra este valor con heurística catastral.
  "ventanas_patios_por_planta": { "1": number, "2": number, ... },
  "ventanas_patios_por_patio": { "P01": number, "PATIO_2": number },  // ventanas por patio si identificable, si no omite la clave
  "patios_detectados": number,
  "patios_codigos": ["P01","P02","PATIO_3"],         // UNA entrada por patio (rellena con PATIO_N si no tiene etiqueta). length == patios_detectados.
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
  "plantas_desglose": { "pb": number, "entresuelo": number, "plantas_tipo": number, "atico": number },
  "ancho_calle_estimado_m": number,
  "metricas_extra": { "observaciones": string },
  "metricas_detalle": {
    "ventanas_fachada_total": { "value": 28, "source": ["street_view_heading_0","satellite"], "reasoning": "...", "confidence": 0.8 },
    "ventanas_patios_total": { "value": 42, "source": ["catastro_pdf_piso_01","dnprc_json"], "reasoning": "Estimación visual prudente que luego se recalibra con viviendas catastrales y patios detectados.", "confidence": 0.6 },
    "patios_detectados": { "value": 7, "source": ["catastro_pdf_piso_01","satellite"], "reasoning": "...", "confidence": 0.85 },
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
Si una métrica no es deducible, usa null y baja confidence. SIEMPRE incluye reasoning en español, no en inglés.

REGLA CRÍTICA — VENTANAS DE FACHADA (ventanas_fachada_total):
- "Fachada" = TODAS las fachadas EXTERIORES a vía pública. La fachada principal SIEMPRE; las laterales SOLO si el edificio hace esquina y dan también a calle. CRUZA con el plano del PISO 01 y la vista satélite cenital: si en planta la huella tiene dos lados que limitan con calle (en vez de medianera), el edificio es de DOS FACHADAS y debes contar ambas.
- NO incluyas fachada trasera, medianeras ni fachadas que dan a patios interiores.
- METODOLOGÍA OBLIGATORIA — SIGUE LOS PASOS EN ORDEN:
    1) Identifica TODOS los FORJADOS VISIBLES en Street View. Cada forjado = 1 planta. Incluye SIEMPRE:
       - PB (planta baja, AUNQUE solo tenga locales, escaparates, persianas metálicas o portal — cuenta IGUAL)
       - ENTRESUELO / ENTREPLANTA si existe (forjado intermedio entre PB y P1, ventanas más bajas/distintas)
       - Plantas tipo (P1, P2…)
       - Ático retranqueado si es visible
       Devuelve plantas_desglose: { "pb": 1, "entresuelo": 0|1, "plantas_tipo": N, "atico": 0|1 }.
    2) Identifica el número de "EJES VERTICALES" en las plantas tipo (columnas de huecos alineadas verticalmente).
       REGLA DE ORO: TODAS las plantas tienen el MISMO número de ejes verticales — incluida PB y entresuelo —, aunque en PB los huecos sean puertas de local, escaparates o portal en vez de ventanas residenciales. Cada portal, escaparate, persiana metálica o ventana de local cuenta como 1 hueco = 1 eje.
    3) ventanas_fachada_total = nº ejes × (pb + entresuelo + plantas_tipo + atico).
       PROHIBIDO restar PB o entresuelo bajo ningún concepto (ni por "solo es portal", ni "solo locales", ni "no son residenciales"). Si los huecos de PB están menos visibles por toldos/coches/árboles, aplica el mismo nº de ejes que las plantas tipo (SIMETRÍA OBLIGATORIA).
    4) ÁRBOLES, FAROLAS, COCHES, TOLDOS, MARQUESINAS pueden tapar huecos. NUNCA reduzcas el conteo por oclusión.
    5) Si el edificio hace esquina y se ven 2 fachadas a vía pública, suma los ejes de AMBAS multiplicado por (pb + entresuelo + plantas_tipo + atico).
- ventanas_por_planta debe reflejar este conteo planta a planta empezando en "1" = PB, "2" = entresuelo o P1, etc., y sumar ventanas_fachada_total.
- Para patios interiores: si entre las imágenes hay alguna con source "aerial" o "oblique" que muestre los patios desde arriba, CUENTA VISUALMENTE las ventanas en las paredes interiores de patio. Solo si no hay visibilidad, recurre a la heurística catastral.

REGLA CRÍTICA — PLANTAS_VISIBLES:
- plantas_visibles = pb + entresuelo + plantas_tipo + atico (suma del desglose). Si ves PB + 6 plantas residenciales → plantas_visibles = 7. Si además hay entresuelo y ático visibles → 8.
- Cruza con el plano catastral: si el plano lista PB, PISO 01..PISO 06, son 7. No restes ni sumes "por convención".

REGLA CRÍTICA — ANÁLISIS DE PATIOS Y ESCALERAS:
- SIEMPRE sobre el plano del PISO 01 (primera planta tipo). Está disponible en TODOS los edificios (es parte de la consulta descriptiva del Catastro). Si no lo identificas claramente entre las páginas, usa la página de plantas que más viviendas (VA, VB...) tenga — esa es el piso tipo.`;
}

function clampInt(value: unknown, min: number, max: number) {
  const n = Number(value ?? 0);
  if (!isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function countDnprcViviendas(dnprc: any): number | null {
  const subparcelas = Array.isArray(dnprc?.subparcelas) ? dnprc.subparcelas : [];
  if (!subparcelas.length) return null;

  const total = subparcelas.filter((sp: any) => {
    const uso = String(sp?.uso ?? "").toLowerCase();
    const usoCode = String(sp?.uso_code ?? sp?.codigo_uso ?? "").toUpperCase();
    return uso.includes("vivienda") || usoCode === "V";
  }).length;

  return total > 0 ? total : null;
}

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

    // Ejecuta el análisis en segundo plano para evitar el timeout de 150s.
    // El cliente debe sondear processing_status / building_analysis.
    // @ts-ignore EdgeRuntime global proporcionado por Supabase
    EdgeRuntime.waitUntil(runVisionAnalysis(sb, building_id, LOVABLE_API_KEY));
    return json({ status: "processing", building_id }, 202);
  } catch (e) {
    console.error("analyze-building-vision error", e);
    return err(String((e as Error).message ?? e));
  }
});

async function runVisionAnalysis(sb: any, building_id: string, LOVABLE_API_KEY: string) {
  const startedAt = Date.now();
  try {

    // Recoge URLs públicas
    const { data: cat } = await sb
      .from("catastro_data")
      .select("plano_url, refcatastral, plantas_pages_urls, plantas_num_pages, plantas_pdf_disponible, fxcc_pages_urls, fxcc_num_pages, fxcc_disponible, dnprc_json")
      .eq("building_id", building_id).maybeSingle();
    const { data: imgs } = await sb
      .from("building_imagery").select("source, public_url, heading").eq("building_id", building_id);

    const imageUrls: string[] = [];
    // 1) Páginas del PDF — preferimos FXCC (croquis por plantas reales) sobre la consulta descriptiva.
    const fxccPages: string[] = Array.isArray(cat?.fxcc_pages_urls) ? cat!.fxcc_pages_urls : [];
    const descPages: string[] = Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : [];
    const plantasPages: string[] = fxccPages.length > 0 ? fxccPages : descPages;
    const planoSource = fxccPages.length > 0 ? "fxcc" : "descriptivo";
    console.log(`[vision] building=${building_id} plano_source=${planoSource} pages=${plantasPages.length}`);
    plantasPages.forEach((u) => imageUrls.push(u));
    // 2) Fallback: si no hay PNGs de plantas, el croquis SVG
    if (plantasPages.length === 0 && cat?.plano_url) imageUrls.push(cat.plano_url);
    // 3) Street View + satélite
    (imgs ?? []).forEach((i: any) => imageUrls.push(i.public_url));

    if (imageUrls.length === 0) {
      await setProcessingStatus(building_id, "vision", "error", "sin imágenes para analizar");
      return;
    }

    const PROMPT = buildPrompt(plantasPages.length || 1, planoSource as any);

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
    // Pro como primario: el flash-lite infracuenta ventanas de fachada (p.ej. Porvenir 8 da 8 cuando son ~24).
    const primaryModel = "google/gemini-3.1-pro-preview";
    const fallbackModel = "google/gemini-2.5-pro";
    let modelo_usado = primaryModel;
    let modelo_fallback = false;
    let llm_raw: any = null;
    let lastErr: string | null = null;

    // Intenta hasta 3 veces con el modelo primario (Gemini 3.1 Flash Lite). Si falla, fallback a Gemini 3.1 Pro.
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

    // Fallback a Gemini 3.1 Pro si el primario no devolvió resultado válido
    if (!parsed) {
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        try {
          const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(buildPayload(fallbackModel)),
          });
          if (r.status === 429 || r.status === 402) {
            lastErr = `gateway ${r.status} (fallback)`;
            await sleep(3000 * (attempt + 1));
            continue;
          }
          const j = await r.json();
          llm_raw = j;
          const txt = j?.choices?.[0]?.message?.content ?? "";
          try {
            parsed = JSON.parse(txt);
            modelo_usado = fallbackModel;
            modelo_fallback = true;
          } catch { lastErr = "JSON inválido (fallback)"; }
        } catch (e) {
          lastErr = String((e as Error).message ?? e);
          await sleep(3000 * (attempt + 1));
        }
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

    const ventFachada = clampInt(parsed.ventanas_fachada_total, 0, 200);
    const fachadaLineal = Number(parsed.fachada_lineal_total_m ?? 0);
    const patiosCods: string[] = Array.isArray(parsed.patios_codigos) ? parsed.patios_codigos : [];
    const patiosAreas: Record<string, number> = (parsed.patios_areas_m2 && typeof parsed.patios_areas_m2 === "object") ? parsed.patios_areas_m2 : {};
    const paredesPorPatio: Record<string, number> = (parsed.paredes_por_patio && typeof parsed.paredes_por_patio === "object") ? parsed.paredes_por_patio : {};
    const nPatios = Math.max(Number(parsed.patios_detectados ?? patiosCods.length ?? 0), patiosCods.length);
    const dnprcViviendas = countDnprcViviendas(cat?.dnprc_json);
    const plantasParaFallback = Math.max(plantasVis, 1);
    const viviendasTotales = dnprcViviendas;
    const densidad = (isFinite(fachadaLineal) && fachadaLineal > 0 && ventFachada > 0) ? +(ventFachada / fachadaLineal).toFixed(3) : null;

    // ============================================================
    // FÓRMULA PAREDES: ventanas_patio_i = paredes_visibles_patio_i × plantas_visibles × 1
    // (proyectamos las ventanas de fachada al patio: 1 ventana/pared/planta)
    // Si IA no devuelve paredes para un patio, asumimos 4 (típico patio cerrado madrileño).
    // Patios muy pequeños (<10 m², patio de luces) → 2 paredes efectivas (solo baños/cocinas).
    // ============================================================
    const paredesEfectivas = (codigo: string, area: number | null): { paredes: number; fuente: "ia" | "fallback_area" | "fallback_default" } => {
      const raw = Number(paredesPorPatio[codigo]);
      if (isFinite(raw) && raw >= 1 && raw <= 6) return { paredes: Math.round(raw), fuente: "ia" };
      if (area != null && area < 10) return { paredes: 2, fuente: "fallback_area" };
      return { paredes: 4, fuente: "fallback_default" };
    };

    const desglose: Array<{ codigo: string; area_m2: number | null; paredes: number; paredes_fuente: string; plantas: number; ventanas_estimadas: number }> = [];
    let ventanasPatioEstim = 0;

    if (nPatios > 0) {
      const codigos = patiosCods.length ? patiosCods : Array.from({ length: nPatios }, (_, i) => `PATIO_${i + 1}`);
      for (const cod of codigos) {
        const areaRaw = Number(patiosAreas[cod]);
        const area = isFinite(areaRaw) && areaRaw > 0 ? areaRaw : null;
        const { paredes, fuente } = paredesEfectivas(cod, area);
        const vent = paredes * plantasParaFallback * 1;
        ventanasPatioEstim += vent;
        desglose.push({
          codigo: cod,
          area_m2: area,
          paredes,
          paredes_fuente: fuente,
          plantas: plantasParaFallback,
          ventanas_estimadas: vent,
        });
      }
    }

    const ventanasPatioBase = ventanasPatioEstim;
    const totalParedes = desglose.reduce((s, d) => s + d.paredes, 0);

    let ventanasTotal = ventFachada + ventanasPatioEstim;
    let confianzaVent: number = Number(parsed.confidence ?? 0.7);
    let ratioVentanasPorVivienda: number | null = null;
    let avisoVent: string | null = null;
    let ajusteFormulaTxt: string | null = null;

    if (viviendasTotales && viviendasTotales > 0) {
      ratioVentanasPorVivienda = +(ventanasTotal / viviendasTotales).toFixed(2);
      if (ratioVentanasPorVivienda > 10) {
        const objetivo = viviendasTotales * 8;
        ventanasPatioEstim = Math.max(0, Math.round(objetivo - ventFachada));
        ventanasTotal = ventFachada + ventanasPatioEstim;
        confianzaVent = 0.5;
        avisoVent = `Ratio ${ratioVentanasPorVivienda} > 10 fuera de rango. Capeado a ${ventanasTotal} (${viviendasTotales} viv × 8).`;
        // re-escalar desglose proporcionalmente
        const sumaOriginal = desglose.reduce((s, d) => s + d.ventanas_estimadas, 0);
        if (sumaOriginal > 0) {
          const escala = ventanasPatioEstim / sumaOriginal;
          for (const d of desglose) d.ventanas_estimadas = Math.round(d.ventanas_estimadas * escala);
        }
      } else if (ratioVentanasPorVivienda < 4) {
        // Ajuste conservador: si la geometría queda corta, densificamos el patio sin escalar por nº de viviendas.
        // Máximo prudente: 2 ventanas por pared y planta en patios interiores.
        const objetivo = Math.max(ventanasPatioEstim, totalParedes * plantasParaFallback * 2);
        if (objetivo > ventanasPatioEstim) {
          const original = ventanasPatioEstim;
          ventanasPatioEstim = objetivo;
          ventanasTotal = ventFachada + ventanasPatioEstim;
          confianzaVent = 0.5;
          ajusteFormulaTxt = `Ajuste conservador por infraestimación: Σparedes ${totalParedes} × ${plantasParaFallback} plantas × 2 ventanas/pared = ${objetivo}.`;
          avisoVent = `Ratio original ${ratioVentanasPorVivienda} < 4. Ajustado de forma conservadora: patio ${original}→${ventanasPatioEstim} usando geometría del patio (máx. 2 ventanas por pared y planta), sin escalar por número de viviendas. Nuevo total ${ventanasTotal}.`;
          // re-escalar desglose proporcionalmente
          const sumaOriginal = desglose.reduce((s, d) => s + d.ventanas_estimadas, 0);
          if (sumaOriginal > 0) {
            const escala = ventanasPatioEstim / sumaOriginal;
            for (const d of desglose) d.ventanas_estimadas = Math.round(d.ventanas_estimadas * escala);
          } else if (desglose.length > 0) {
            const base = Math.floor(ventanasPatioEstim / desglose.length);
            const resto = ventanasPatioEstim % desglose.length;
            desglose.forEach((d, i) => { d.ventanas_estimadas = base + (i < resto ? 1 : 0); });
          }
        } else {
          confianzaVent = 0.4;
          avisoVent = `Ratio ${ratioVentanasPorVivienda} < 4. Posible infraestimación de Street View; no se autoajusta.`;
        }
      } else {
        avisoVent = `Ratio ${ratioVentanasPorVivienda} ventanas/vivienda dentro del rango plausible Madrid (4-10).`;
      }
    }

    const ratioFinal = viviendasTotales && viviendasTotales > 0 ? +(ventanasTotal / viviendasTotales).toFixed(2) : null;
    const ventanasPatiosPorPatio = desglose.length > 0
      ? Object.fromEntries(desglose.map((item) => [item.codigo, item.ventanas_estimadas ?? 0]))
      : null;
    const ventanasPatiosPorPlanta = ventanasPatioEstim > 0 && plantasParaFallback > 0
      ? Object.fromEntries(Array.from({ length: plantasParaFallback }, (_, i) => {
          const base = Math.floor(ventanasPatioEstim / plantasParaFallback);
          const extra = i < (ventanasPatioEstim % plantasParaFallback) ? 1 : 0;
          return [String(i + 1), base + extra];
        }))
      : null;

    const resumenPatios = desglose.map(d => `${d.codigo}(${d.paredes}p${d.paredes_fuente === "ia" ? "" : "*"}${d.area_m2 != null ? `,${Math.round(d.area_m2)}m²` : ""})`).join(", ");
    const formulaBaseTxt = `${nPatios} patios × paredes visibles (Σ=${totalParedes}) × ${plantasParaFallback} plantas × 1 ventana/pared = ${ventanasPatioBase} ventanas a patio.`;
    const formulaTxt = `${formulaBaseTxt}${ajusteFormulaTxt ? ` ${ajusteFormulaTxt}` : ""} Total con fachada = ${ventFachada}+${ventanasPatioEstim}=${ventanasTotal}. Ratio ventanas/vivienda = ${ratioFinal ?? "—"} (rango plausible 4-10). Lógica: la estimación de patio se apoya en la geometría visible del patio y se mantiene conservadora; no se multiplica por el número de viviendas. Detalle por patio: ${resumenPatios || "—"} (* = paredes asumidas por fallback).`;

    const ventanasPatiosTotalFinal = ventanasPatioEstim;

    await sb.from("building_analysis").upsert({
      building_id,
      ventanas_fachada_total: ventFachada,
      ventanas_por_planta: parsed.ventanas_por_planta ?? null,
      ventanas_patios_total: ventanasPatiosTotalFinal,
      ventanas_patios_estimadas: ventanasPatioEstim,
      ventanas_patios_desglose: desglose.length > 0 ? desglose : null,
      densidad_ventanas_fachada: densidad,
      fachada_lineal_total_m: isFinite(fachadaLineal) && fachadaLineal > 0 ? fachadaLineal : null,
      formula_ventanas_patio: formulaTxt,
      confidence_ventanas: confianzaVent,
      aviso_ventanas: avisoVent,
      ventanas_patios_por_planta: ventanasPatiosPorPlanta,
      ventanas_patios_por_patio: ventanasPatiosPorPatio,
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
      metricas_detalle: {
        ...(parsed.metricas_detalle ?? {}),
        ventanas_fachada_total: {
          value: ventFachada,
          source: ["street_view_heading_0", "street_view_heading_90", "street_view_heading_180", "street_view_heading_270"],
          reasoning: `Conteo directo de ventanas en Street View, capado al rango plausible 0-200. Valor final: ${ventFachada}.`,
          confidence: Math.min(Number(parsed?.metricas_detalle?.ventanas_fachada_total?.confidence ?? parsed.confidence ?? 0.7), 0.95),
        },
        ventanas_patios_total: {
          value: ventanasPatioEstim,
          source: viviendasTotales && viviendasTotales > 0 ? ["dnprc_json", "catastro_pdf_piso_01"] : ["catastro_pdf_piso_01", "inferred_symmetry"],
          reasoning: ajusteFormulaTxt
            ? `${nPatios} patios detectados. Estimación geométrica del patio reajustada de forma conservadora con paredes visibles y plantas analizadas, sin escalar por número de viviendas.`
            : `${nPatios} patios detectados. Estimación geométrica: patios × paredes visibles × plantas analizadas × 1 ventana/pared.`,
          confidence: confianzaVent,
        },
      },
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