import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

// Toma el último análisis IA + breakdown del score y genera:
// - avisos_inteligentes[] con reasoning natural por cada aviso
// - confianza_media (promedio confidence de metricas_detalle)
// - score_summary (párrafo narrativo generado por LLM)
// Persiste en buildings (avisos_inteligentes, score_summary, confianza_media).

type Aviso = {
  key: string;
  label: string;
  icon: string;
  color: "oportunidad" | "alerta" | "neutro";
  reasoning: string;
  confidence: number | null;
  sources: string[];
};

function pickDetalle(detalle: any, key: string) {
  return detalle && typeof detalle === "object" ? detalle[key] : null;
}

function buildAvisos(an: any, cat: any): Aviso[] {
  const out: Aviso[] = [];
  const d = an?.metricas_detalle ?? {};

  // Ventanas
  const ventTotal = an?.ventanas_fachada_total;
  if (typeof ventTotal === "number" && ventTotal >= 20) {
    const det = pickDetalle(d, "ventanas_fachada_total");
    const reasoning = det?.reasoning
      ?? `Detectadas ${ventTotal} ventanas exteriores totales en fachadas analizadas. Más ventanas = más habitaciones potenciales y mejor iluminación natural.`;
    out.push({
      key: "ventanas_total",
      label: `🪟 ${ventTotal} ventanas`,
      icon: "windows",
      color: "oportunidad",
      reasoning,
      confidence: det?.confidence ?? an?.confidence ?? null,
      sources: Array.isArray(det?.source) ? det.source : ["street_view"],
    });
  }

  // Plantas elevables
  const lev = an?.plantas_levantables;
  if (typeof lev === "number" && lev >= 1) {
    const det = pickDetalle(d, "plantas_levantables");
    const ancho = cat?.ancho_calle_m;
    const visibles = an?.plantas_visibles;
    const maxNorm = an?.plantas_max_normativa;
    const reasoning = det?.reasoning
      ?? `Ancho calle ${ancho ? `${ancho}m` : "estimado"} → normativa Madrid permite hasta ${maxNorm ?? "?"} plantas sobre rasante. Plantas actuales visibles: ${visibles ?? "?"}. Diferencial = +${lev} plantas. Cada planta añadida puede sumar cientos de miles de € al valor.`;
    out.push({
      key: "plantas_levantables",
      label: `🏗️ +${lev} plantas elevables`,
      icon: "stack",
      color: "oportunidad",
      reasoning,
      confidence: det?.confidence ?? 0.7,
      sources: Array.isArray(det?.source) ? det.source : ["calculated_from_ancho_calle"],
    });
  }

  // 2 escaleras (cambio uso hotelero)
  const escPiso01 = an?.n_escaleras_en_piso01;
  if (typeof escPiso01 === "number" && escPiso01 >= 2) {
    const det = pickDetalle(d, "n_escaleras_en_piso01");
    const reasoning = det?.reasoning
      ?? `Detectadas ${escPiso01} cajas ESC independientes en PISO 01 del PDF de distribución de plantas catastral. Cumple criterio normativa Madrid para cambio de uso hotelero (requisito de evacuación dual).`;
    out.push({
      key: "escaleras_dobles",
      label: `🪜 ${escPiso01} escaleras`,
      icon: "stairs",
      color: "oportunidad",
      reasoning,
      confidence: det?.confidence ?? 0.95,
      sources: Array.isArray(det?.source) ? det.source : ["catastro_pdf_piso_01"],
    });
  }

  // Esquina
  if (an?.esquina === true) {
    const det = pickDetalle(d, "esquina");
    const reasoning = det?.reasoning
      ?? `Parcela con fachada a 2 calles según vistas aéreas y Street View. Maximiza ventanas exteriores, luz natural y dobles vistas — muy valorado para conversión hotelera o residencial premium.`;
    out.push({
      key: "esquina",
      label: "📍 Esquina",
      icon: "corner",
      color: "oportunidad",
      reasoning,
      confidence: det?.confidence ?? 0.9,
      sources: Array.isArray(det?.source) ? det.source : ["satellite", "street_view"],
    });
  }

  // Histórico
  if (an?.protegido_historicamente === true) {
    const det = pickDetalle(d, "protegido_historicamente");
    const reasoning = det?.reasoning
      ?? `Fachada con cornisa labrada, miradores de hierro forjado y frisos decorativos típicos años 1900-1940. Estilo arquitectónico potencialmente protegido por PGOU Madrid Centro. Requiere consulta oficial.`;
    out.push({
      key: "historico",
      label: "🏛️ Histórico",
      icon: "landmark",
      color: "alerta",
      reasoning,
      confidence: det?.confidence ?? 0.75,
      sources: Array.isArray(det?.source) ? det.source : ["street_view"],
    });
  }

  // % terciario
  const pctTerc = an?.metricas_extra?.pct_terciario;
  if (typeof pctTerc === "number" && pctTerc > 0.66) {
    const det = pickDetalle(d, "metricas_extra.pct_terciario");
    const reasoning = det?.reasoning
      ?? `Suma de superficies terciarias (locales CCE + garajes GC + oficinas) representa ${(pctTerc * 100).toFixed(0)}% sobre el total construido. Supera el umbral del 66%, lo que clasifica al inmueble como uso predominantemente terciario.`;
    out.push({
      key: "terciario_alto",
      label: `🏢 >${(pctTerc * 100).toFixed(0)}% terciario`,
      icon: "office",
      color: "alerta",
      reasoning,
      confidence: det?.confidence ?? 0.85,
      sources: Array.isArray(det?.source) ? det.source : ["dnprc_json"],
    });
  }

  return out;
}

function avgConfidence(metricasDetalle: any): number | null {
  if (!metricasDetalle || typeof metricasDetalle !== "object") return null;
  const vals: number[] = [];
  for (const k of Object.keys(metricasDetalle)) {
    const v = metricasDetalle[k];
    if (v && typeof v === "object" && typeof v.confidence === "number") vals.push(v.confidence);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function generateSummary(building: any, score: number | null, breakdown: any, avisos: Aviso[], an: any): Promise<string | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return null;
  const prompt = `Eres un analista inmobiliario senior en Madrid. Genera un párrafo narrativo de 4-8 frases en español explicando por qué el siguiente edificio obtiene el score asignado. Menciona qué componentes empujan al alza (oportunidades), qué penalizaciones tiene, y termina con CONCLUSIÓN clara: edificio de potencial ALTO/MEDIO/BAJO + recomendación accionable (prioridad de contacto, descartar, etc.). Tono profesional, directo, sin marketing.

Datos:
- Dirección: ${building?.direccion ?? "—"} (${building?.ciudad ?? "—"})
- Score total: ${score ?? "—"}
- Score breakdown: ${JSON.stringify(breakdown ?? {})}
- Avisos detectados: ${JSON.stringify(avisos.map(a => ({ label: a.label, reasoning: a.reasoning })))}
- Métricas IA: ventanas=${an?.ventanas_fachada_total ?? "—"}, plantas_visibles=${an?.plantas_visibles ?? "—"}, plantas_levantables=${an?.plantas_levantables ?? "—"}, escaleras_piso01=${an?.n_escaleras_en_piso01 ?? "—"}, esquina=${an?.esquina ?? "—"}, historico=${an?.protegido_historicamente ?? "—"}

Devuelve SOLO el párrafo, sin encabezados ni listas.`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      console.warn("summary gateway", r.status);
      return null;
    }
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    console.warn("summary fail", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { building_id } = await req.json();
    if (!building_id) return err("building_id requerido", 400);

    const sb = getServiceClient();

    // Asegurar score por clusters corrido (idempotente, baratísimo)
    await sb.rpc("compute_cluster_score", { p_building_id: building_id });

    const [{ data: bld }, { data: an }, { data: cat }] = await Promise.all([
      sb.from("buildings").select("id, direccion, ciudad, score, score_breakdown, cluster_asignado, cluster_motivo").eq("id", building_id).maybeSingle(),
      sb.from("building_analysis").select("*").eq("building_id", building_id).maybeSingle(),
      sb.from("catastro_data").select("ancho_calle_m").eq("building_id", building_id).maybeSingle(),
    ]);

    if (!bld) return err("building no encontrado", 404);

    const avisos = buildAvisos(an, cat);
    const confianza = avgConfidence(an?.metricas_detalle);
    const summary = await generateSummary(bld, bld?.score, bld?.score_breakdown, avisos, an);

    await sb.from("buildings").update({
      avisos_inteligentes: avisos,
      score_summary: summary,
      confianza_media: confianza,
    }).eq("id", building_id);

    return json({ ok: true, avisos_count: avisos.length, confianza, summary_generated: !!summary });
  } catch (e) {
    console.error("enhance-building-score error", e);
    return err(String((e as Error).message ?? e));
  }
});