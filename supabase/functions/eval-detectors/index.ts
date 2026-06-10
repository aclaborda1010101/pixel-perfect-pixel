// eval-detectors
// A/B evaluation framework: compara variantes de detección de escaleras
// (y ventanas, esquina en el futuro) contra qa_ground_truth SIN tocar
// producción. Cada variante recibe un building y devuelve un valor; la
// función compara contra GT y devuelve % de acierto por variante.
//
// Body:
//   { detector: "escaleras" | "ventanas" | "esquina", variants?: string[] }

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

// --- Variantes para ESCALERAS ---
type Ctx = { sb: any; apiKey: string; building: any; cat: any; ba: any; cac: any };

const VARIANTS_ESCALERAS: Record<string, (c: Ctx) => Promise<number | null>> = {
  // V0 BASELINE: lo que está hoy persistido (n_escaleras_en_piso01 antes del overhaul).
  v0_baseline_db: async ({ ba }) => ba?.n_escaleras_en_piso01 ?? null,

  // V1 Solo DNPRC: nº de loint.es distintos = escaleras catastrales.
  v1_subparcelas_only: async ({ cac }) => cac?.n_subparcelas_residenciales ?? null,

  // V2 Solo VLM focalizado PISO 01 (mismo prompt que recount-escaleras).
  v2_vlm_piso01: async (c) => callVlmFocused(c, false),

  // V3 MAX(V1, V2).
  v3_max_vlm_dnprc: async (c) => {
    const a = await VARIANTS_ESCALERAS.v1_subparcelas_only(c);
    const b = await VARIANTS_ESCALERAS.v2_vlm_piso01(c);
    if (a == null && b == null) return null;
    return Math.max(a ?? 0, b ?? 0);
  },

  // V4 VLM con few-shot (ejemplo anotado dentro del prompt) sobre TODAS las páginas.
  v4_vlm_fewshot: async (c) => callVlmFocused(c, true),

  // V5 MAX(V1, V4).
  v5_max_fewshot_dnprc: async (c) => {
    const a = await VARIANTS_ESCALERAS.v1_subparcelas_only(c);
    const b = await VARIANTS_ESCALERAS.v4_vlm_fewshot(c);
    if (a == null && b == null) return null;
    return Math.max(a ?? 0, b ?? 0);
  },

  // V6 VLM few-shot PRIMARIO; DNPRC solo como desempate cuando confidence < 0.6.
  v6_vlm_primary_dnprc_tiebreak: async (c) => {
    const r = await callVlmFocusedFull(c, true);
    if (!r) return null;
    if (r.confidence != null && r.confidence < 0.6) {
      const sub = await VARIANTS_ESCALERAS.v1_subparcelas_only(c);
      if (typeof sub === "number" && sub >= 1) return Math.max(r.n, sub);
    }
    return r.n;
  },
};

async function callVlmFocused(c: Ctx, fewshot: boolean): Promise<number | null> {
  const r = await callVlmFocusedFull(c, fewshot);
  return r ? r.n : null;
}

async function callVlmFocusedFull(c: Ctx, fewshot: boolean): Promise<{ n: number; confidence: number | null } | null> {
  const pages: string[] = Array.isArray(c.cat?.fxcc_pages_urls) && c.cat.fxcc_pages_urls.length
    ? c.cat.fxcc_pages_urls
    : (Array.isArray(c.cat?.plantas_pages_urls) ? c.cat.plantas_pages_urls : []);
  if (!pages.length) return null;

  const fewshotBlock = fewshot ? `

EJEMPLOS ANOTADOS (importantes):
- Edificio Serrano 16 (Madrid): el FXCC tiene una página "PISO 01" con 2 cajas ESC,
  una en el núcleo norte (ESC_A) y otra en el sur (ESC_B), separando bloques V.A.* y V.B.*.
  Resultado correcto: n_escaleras_piso01 = 2.
- Edificio Cava Baja 42: edificio en chaflán con DOS portales independientes que dan a
  Cava Baja y a Plaza del Humilladero; en PISO 01 hay 2 núcleos ESC, uno por portal.
  Resultado correcto: n_escaleras_piso01 = 2. Aunque el plano sea pequeño y los
  núcleos parezcan parte de un mismo bloque, son INDEPENDIENTES.
- Edificio Postigo de San Martín 6: PISO 01 muestra 2 cajas ESC simétricas. n = 2.
- Si SOLO ves 1 núcleo claro y todas las viviendas son V.A.* (sin V.B.*), entonces n = 1.
` : "";

  const PROMPT = `Eres un experto en planos FXCC del Catastro de Madrid.
TAREA ÚNICA: cuenta las cajas de escalera (ESC) en la PLANTA 1 (PISO 01).
- Localiza la página "PISO 01" / "PLANTA 01" / "PLANTA 1ª" (no la planta baja).
- Una caja de escalera es un recinto cerrado rectangular separando bloques V.A.* y V.B.*.
- NUNCA cuentes sobre planta baja; ahí escalera y portal se confunden.
- Pistas adicionales: 2 grupos de viviendas (V.A vs V.B), 2 portales, edificio en chaflán o doble fachada → suelen indicar 2 escaleras.${fewshotBlock}

Responde SOLO con JSON: {"n_escaleras_piso01": number, "razonamiento": string, "confidence": number}`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-pro-preview",
        messages: [{ role: "user", content: [
          { type: "text", text: PROMPT },
          ...pages.map((url) => ({ type: "image_url", image_url: { url } })),
        ]}],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(txt);
    const n = Math.max(1, Math.min(8, Math.round(Number(parsed?.n_escaleras_piso01 ?? 1))));
    const conf = parsed?.confidence != null ? Number(parsed.confidence) : null;
    return isFinite(n) ? { n, confidence: conf } : null;
  } catch { return null; }
}

async function loadCtx(sb: any, apiKey: string, building_id: string): Promise<Ctx | null> {
  const { data: b } = await sb.from("buildings").select("id, direccion, refcatastral").eq("id", building_id).maybeSingle();
  if (!b) return null;
  const { data: cat } = await sb.from("catastro_data").select("fxcc_pages_urls, plantas_pages_urls").eq("building_id", building_id).maybeSingle();
  const { data: ba } = await sb.from("building_analysis").select("n_escaleras_en_piso01, segundas_escaleras, n_escaleras_final, n_escaleras_fuente").eq("building_id", building_id).maybeSingle();
  const rc14 = String(b.refcatastral ?? "").slice(0, 14);
  const { data: cac } = rc14 ? await sb.from("catastro_authority_cache").select("n_subparcelas_residenciales").eq("refcatastral_14", rc14).maybeSingle() : { data: null };
  return { sb, apiKey, building: b, cat, ba, cac };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return err("LOVABLE_API_KEY missing", 500);

  const body = await req.json().catch(() => ({}));
  const detector = body.detector ?? "escaleras";
  const variants: string[] = body.variants ?? ["v0_baseline_db", "v1_subparcelas_only", "v2_vlm_piso01", "v3_max_vlm_dnprc"];
  const asyncMode = body.async === true;

  if (detector !== "escaleras") return err("solo 'escaleras' implementado por ahora", 400);

  const sb = getServiceClient();

  // Set de control: qa_ground_truth con escaleras NOT NULL.
  const { data: gtRows } = await sb.from("qa_ground_truth")
    .select("building_id, direccion_raw, escaleras")
    .not("building_id", "is", null)
    .not("escaleras", "is", null);
  // Dedup por building_id (la primera ocurrencia).
  const seen = new Set<string>();
  const gt = (gtRows ?? []).filter((r: any) => {
    if (seen.has(r.building_id)) return false; seen.add(r.building_id); return true;
  });

  const run = async () => {
    const rows: any[] = [];
    for (const r of gt) {
      const ctx = await loadCtx(sb, apiKey, r.building_id);
      if (!ctx) { rows.push({ ...r, error: "no ctx" }); continue; }
      const out: any = { building_id: r.building_id, direccion: r.direccion_raw, gt: r.escaleras };
      for (const v of variants) {
        try { out[v] = await VARIANTS_ESCALERAS[v]?.(ctx) ?? null; }
        catch (e) { out[v] = null; out[`${v}_error`] = (e as Error).message; }
      }
      rows.push(out);
      // Persistencia incremental para no perder progreso.
      if (rows.length % 5 === 0) {
        await sb.from("app_settings").upsert({
          key: `eval_detectors_${detector}_partial`,
          value: { detector, progress: `${rows.length}/${gt.length}`, rows } as any,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key" });
      }
    }
    // Métricas por variante: acierto = (predicho == gt) o (predicho >= 2 y gt >= 2) para señal binaria.
    const metrics: Record<string, any> = {};
    for (const v of variants) {
      const total = rows.filter(r => r[v] != null).length;
      const exactos = rows.filter(r => r[v] === r.gt).length;
      const seg_correct = rows.filter(r => (r[v] >= 2) === (r.gt >= 2)).length;
      const tp = rows.filter(r => r.gt >= 2 && r[v] >= 2).length;
      const fn = rows.filter(r => r.gt >= 2 && (r[v] ?? 1) < 2).length;
      const fp = rows.filter(r => r.gt < 2 && r[v] >= 2).length;
      const tn = rows.filter(r => r.gt < 2 && (r[v] ?? 1) < 2).length;
      const seg2_gt = tp + fn;
      const recall = seg2_gt ? tp / seg2_gt : null;
      const precision = (tp + fp) ? tp / (tp + fp) : null;
      const f1 = recall != null && precision != null && (recall + precision) > 0
        ? +(2 * recall * precision / (recall + precision)).toFixed(3) : null;
      metrics[v] = {
        total_con_dato: total,
        exactos,
        pct_exacto: total ? +(exactos / total * 100).toFixed(1) : null,
        seg_correct,
        pct_segundas_correctas: rows.length ? +(seg_correct / rows.length * 100).toFixed(1) : null,
        tp, fn, fp, tn,
        recall_2esc: recall != null ? +(recall * 100).toFixed(1) : null,
        precision_2esc: precision != null ? +(precision * 100).toFixed(1) : null,
        f1_2esc: f1,
        recall_2esc_n: `${tp}/${seg2_gt}`,
        fp_n: `${fp}/${tn + fp}`,
      };
    }
    const out = { detector, total_gt: rows.length, metrics, rows };
    // Persiste el reporte para consulta posterior.
    await sb.from("app_settings").upsert({ key: `eval_detectors_${detector}_last`, value: out as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return out;
  };

  if (asyncMode) {
    // @ts-ignore
    EdgeRuntime.waitUntil(run());
    return json({ ok: true, async: true, queued: gt.length, variants }, 202);
  }
  const r = await run();
  return json(r);
});