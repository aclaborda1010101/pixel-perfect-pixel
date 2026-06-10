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

  // V7 VLM MULTIPÁGINA: pasa planta baja Y piso 01, pide correspondencia
  // portal↔caja de escalera + nº de portales en planta baja como evidencia.
  // DNPRC sigue siendo desempate cuando confidence<0.6 (NO MAX puro).
  v7_vlm_multipagina: async (c) => {
    const r = await callVlmMultipagina(c);
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

async function callVlmMultipagina(c: Ctx): Promise<{ n: number; confidence: number | null } | null> {
  const pages: string[] = Array.isArray(c.cat?.fxcc_pages_urls) && c.cat.fxcc_pages_urls.length
    ? c.cat.fxcc_pages_urls
    : (Array.isArray(c.cat?.plantas_pages_urls) ? c.cat.plantas_pages_urls : []);
  if (!pages.length) return null;

  const PROMPT = `Eres un experto en planos FXCC del Catastro de Madrid.
TAREA: contar cajas de escalera (ESC) en el edificio usando DOS plantas como
evidencia cruzada: PLANTA BAJA y PISO 01.

PROCEDIMIENTO OBLIGATORIO:
1) Localiza la página de PLANTA BAJA ("PB","P.BAJA","PLANTA BAJA"). Cuenta cuántos
   PORTALES independientes de entrada al edificio hay (puertas a la calle que dan
   acceso a un núcleo vertical). En edificios en chaflán o doble fachada suele
   haber 2 portales.
2) Localiza la página de PISO 01 ("PISO 01","PLANTA 01","PLANTA 1ª"). Cuenta las
   cajas de escalera (ESC) — recintos cerrados rectangulares con peldaños/aspas
   que separan bloques V.A.* / V.B.*. NUNCA cuentes sobre planta baja.
3) CORRESPONDENCIA: cada portal de planta baja debe conducir a una caja de
   escalera en piso 01. Si ves 2 portales en PB pero sólo distingues 1 núcleo
   en piso 01, mira de nuevo: probablemente hay 2 cajas pegadas o el plano es
   pequeño. Usa la correspondencia como prior.
4) El RESULTADO FINAL es n_escaleras_piso01 = max(núcleos visibles en piso 01,
   nº de portales independientes en PB confirmados por núcleos en piso 01).

EJEMPLOS:
- Serrano 16: PB con 2 portales (norte/sur) → piso 01 muestra ESC_A y ESC_B → n=2.
- Cava Baja 42: edificio en chaflán, PB con 2 portales (Cava Baja y Plaza del
  Humilladero), piso 01 con 2 núcleos aunque pegados → n=2.
- Postigo de San Martín 6: PB con 2 portales simétricos → piso 01 con 2 ESC → n=2.
- Edificio lineal de fachada única con 1 portal en PB y bloque V.A.* único en
  piso 01 → n=1.

Responde SOLO con JSON:
{
  "n_portales_pb": number,
  "n_nucleos_visibles_piso01": number,
  "n_escaleras_piso01": number,
  "correspondencia_ok": boolean,
  "razonamiento": string,
  "confidence": number
}`;

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
  const variants: string[] = body.variants ?? [
    "v0_baseline_db", "v1_subparcelas_only", "v2_vlm_piso01",
    "v4_vlm_fewshot", "v5_max_fewshot_dnprc", "v6_vlm_primary_dnprc_tiebreak",
  ];
  const asyncMode = body.async === true;
  const batchSize: number = Math.max(1, Math.min(10, body.batch_size ?? 3));
  const reset: boolean = body.reset === true;
  const chainMode: boolean = body.chain === true; // self-reinvoke next batch
  // Subset de control: 10 gt=2 + 10 gt=1 (primeros encontrados).
  const controlMode: boolean = body.control_subset === true;
  const controlSuffix: string = controlMode ? "_control" : "";

  if (detector !== "escaleras") return err("solo 'escaleras' implementado por ahora", 400);

  const sb = getServiceClient();

  // Set de control: qa_ground_truth con escaleras NOT NULL.
  // ORDENAMOS gt=2 PRIMERO (interés alto), después gt=1.
  const { data: gtRows } = await sb.from("qa_ground_truth")
    .select("building_id, direccion_raw, escaleras")
    .not("building_id", "is", null)
    .not("escaleras", "is", null)
    .order("escaleras", { ascending: false });
  const seen = new Set<string>();
  let gt = (gtRows ?? []).filter((r: any) => {
    if (seen.has(r.building_id)) return false; seen.add(r.building_id); return true;
  });
  if (controlMode) {
    const gt2 = gt.filter((r: any) => r.escaleras >= 2).slice(0, 10);
    const gt1 = gt.filter((r: any) => r.escaleras < 2).slice(0, 10);
    gt = [...gt2, ...gt1];
  }

  // Estado parcial persistente
  const partialKey = `eval_detectors_${detector}${controlSuffix}_partial`;
  const { data: prev } = reset ? { data: null } as any
    : await sb.from("app_settings").select("value").eq("key", partialKey).maybeSingle();
  const prevRows: any[] = Array.isArray(prev?.value?.rows) ? prev!.value.rows : [];
  const doneIds = new Set(prevRows.map((r: any) => r.building_id));
  const pending = gt.filter((r: any) => !doneIds.has(r.building_id));
  const batch = pending.slice(0, batchSize);

  const computeMetrics = (rows: any[]) => {
    const metrics: Record<string, any> = {};
    for (const v of variants) {
      const total = rows.filter(r => r[v] != null).length;
      const exactos = rows.filter(r => r[v] === r.gt).length;
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
        total_con_dato: total, exactos,
        pct_exacto: total ? +(exactos / total * 100).toFixed(1) : null,
        tp, fn, fp, tn,
        recall_2esc: recall != null ? +(recall * 100).toFixed(1) : null,
        precision_2esc: precision != null ? +(precision * 100).toFixed(1) : null,
        f1_2esc: f1,
        recall_2esc_n: `${tp}/${seg2_gt}`,
        fp_n: `${fp}/${tn + fp}`,
      };
    }
    return metrics;
  };

  const run = async () => {
    const rows: any[] = [...prevRows];
    for (const r of batch) {
      const ctx = await loadCtx(sb, apiKey, r.building_id);
      if (!ctx) { rows.push({ ...r, error: "no ctx" }); continue; }
      const out: any = { building_id: r.building_id, direccion: r.direccion_raw, gt: r.escaleras };
      for (const v of variants) {
        try { out[v] = await VARIANTS_ESCALERAS[v]?.(ctx) ?? null; }
        catch (e) { out[v] = null; out[`${v}_error`] = (e as Error).message; }
      }
      rows.push(out);
      // Persistencia tras cada edificio (lote pequeño).
      await sb.from("app_settings").upsert({
        key: partialKey,
        value: {
          detector,
          progress: `${rows.length}/${gt.length}`,
          pct: +(rows.length / gt.length * 100).toFixed(1),
          total_gt: gt.length,
          gt2_done: rows.filter(x => x.gt >= 2).length,
          gt2_total: gt.filter(x => x.escaleras >= 2).length,
          metrics_partial: computeMetrics(rows),
          rows,
        } as any,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    }
    const finished = rows.length >= gt.length;
    const metrics = computeMetrics(rows);
    const out = { detector, total_gt: gt.length, processed: rows.length, finished, metrics, rows };
    if (finished) {
      await sb.from("app_settings").upsert({ key: `eval_detectors_${detector}${controlSuffix}_last`, value: out as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }
    // Auto-reinvocación encadenada para el siguiente lote.
    if (!finished && chainMode) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-detectors`;
      const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      // fire-and-forget (no await, no bloquea)
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${srk}`, apikey: srk },
        body: JSON.stringify({ detector, variants, batch_size: batchSize, chain: true, async: true, control_subset: controlMode }),
      }).catch(() => {});
    }
    return out;
  };

  if (asyncMode) {
    // @ts-ignore
    EdgeRuntime.waitUntil(run());
    return json({ ok: true, async: true, queued: batch.length, remaining_before: pending.length, total_gt: gt.length, variants, chain: chainMode }, 202);
  }
  const r = await run();
  return json(r);
});