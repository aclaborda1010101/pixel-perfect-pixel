// eval-detectors
// A/B evaluation framework: compara variantes de detección de escaleras
// (y ventanas, esquina en el futuro) contra qa_ground_truth SIN tocar
// producción. Cada variante recibe un building y devuelve un valor; la
// función compara contra GT y devuelve % de acierto por variante.
//
// Body:
//   { detector: "escaleras" | "ventanas" | "esquina", variants?: string[] }

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

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

  // V8 VLM con CROPS+ZOOM: amplía la región central de cada página (zoom ~2x)
  // y, si el edificio es esquina/chaflán, añade también crops de las esquinas
  // del plano (donde suele estar la 2ª caja). Mantiene few-shot y DNPRC como
  // desempate cuando confidence<0.6 (no MAX puro).
  v8_vlm_crops_zoom: async (c) => {
    const r = await callVlmCropsZoom(c);
    if (!r) return null;
    // Si baja confianza, registra building_feedback para revisión humana.
    if (r.confidence != null && r.confidence < 0.6) {
      try {
        await c.sb.from("building_feedback").insert({
          building_id: c.building.id,
          canal: "eval_detector_v8",
          dimension: "n_escaleras",
          estado: "pendiente",
          texto: `v8 baja confianza (${r.confidence}). n=${r.n}. ${r.razonamiento ?? ""}`.slice(0, 1000),
          metadatos: { variant: "v8_vlm_crops_zoom", n: r.n, confidence: r.confidence } as any,
        });
      } catch (_) {/* idempotencia best-effort */}
      const sub = await VARIANTS_ESCALERAS.v1_subparcelas_only(c);
      if (typeof sub === "number" && sub >= 1) return Math.max(r.n, sub);
    }
    return r.n;
  },
};

  // V9 ROUTER ARQUITECTÓNICO: si n_subparcelas_residenciales>=2 O esquina=true,
  // INVIERTE la pregunta al VLM ("justifica por qué NO hay 2 cajas") con prior
  // fuerte hacia n=2. Si no, prompt normal de v6. DNPRC sigue como desempate
  // cuando confidence<0.6 (no MAX puro). needs_human_review si baja confianza.
VARIANTS_ESCALERAS.v9_vlm_router_arquitectura = async (c) => {
  const sub = c.cac?.n_subparcelas_residenciales ?? null;
  const esquina = c.ba?.esquina === true;
  const prior2 = (typeof sub === "number" && sub >= 2) || esquina;
  const r = prior2 ? await callVlmRouterInverso(c, { sub, esquina }) : await callVlmFocusedFull(c, true);
  if (!r) return null;
  if (r.confidence != null && r.confidence < 0.6) {
    try {
      await c.sb.from("building_feedback").insert({
        building_id: c.building.id,
        canal: "eval_detector_v9",
        dimension: "n_escaleras",
        estado: "pendiente",
        texto: `v9 baja confianza (${r.confidence}). n=${r.n}. prior2=${prior2}`.slice(0, 1000),
        metadatos: { variant: "v9_vlm_router_arquitectura", n: r.n, confidence: r.confidence, prior2 } as any,
      });
    } catch (_) {}
    const s = await VARIANTS_ESCALERAS.v1_subparcelas_only(c);
    if (typeof s === "number" && s >= 1) return Math.max(r.n, s);
  }
  return r.n;
};

// V10 A/B con gemini-2.5-pro como backbone de visión, MISMO prompt que v6
// (few-shot focused) y MISMO desempate DNPRC con confidence<0.6 (no MAX).
// needs_human_review si baja confianza.
VARIANTS_ESCALERAS.v10_gemini25pro_v6prompt = async (c) => {
  const r = await callVlmFocusedFullModel(c, true, "google/gemini-2.5-pro");
  if (!r) return null;
  if (r.confidence != null && r.confidence < 0.6) {
    try {
      await c.sb.from("building_feedback").insert({
        building_id: c.building.id,
        canal: "eval_detector_v10",
        dimension: "n_escaleras",
        estado: "pendiente",
        texto: `v10 (gemini-2.5-pro) baja confianza (${r.confidence}). n=${r.n}`.slice(0, 1000),
        metadatos: { variant: "v10_gemini25pro_v6prompt", n: r.n, confidence: r.confidence } as any,
      });
    } catch (_) {}
    const s = await VARIANTS_ESCALERAS.v1_subparcelas_only(c);
    if (typeof s === "number" && s >= 1) return Math.max(r.n, s);
  }
  return r.n;
};

// V11 SPLIT POR PÁGINA: 1 página por llamada con prompt v6 (gemini-3.1-pro),
// agregación max-vote del n predicho en cada página (las que no son P01 dan
// confidence baja y se ignoran si conf<0.3). DNPRC desempate cuando todas
// las páginas dan confidence<0.6.
VARIANTS_ESCALERAS.v11_split_per_page = async (c) => {
  const pages: string[] = Array.isArray(c.cat?.fxcc_pages_urls) && c.cat.fxcc_pages_urls.length
    ? c.cat.fxcc_pages_urls
    : (Array.isArray(c.cat?.plantas_pages_urls) ? c.cat.plantas_pages_urls : []);
  if (!pages.length) return null;
  const targetPages = pages.slice(0, 6);
  const results: Array<{ n: number; conf: number | null }> = [];
  for (const url of targetPages) {
    const r = await callVlmSinglePage(c, url);
    if (r) results.push(r);
    await new Promise((res) => setTimeout(res, 800));
  }
  if (!results.length) return null;
  // Filtra páginas con confidence>=0.3 (las otras es ruido de páginas no-P01).
  const useful = results.filter((r) => (r.conf ?? 0) >= 0.3);
  const pool = useful.length ? useful : results;
  const maxConf = Math.max(...pool.map((r) => r.conf ?? 0));
  const nMax = Math.max(...pool.map((r) => r.n));
  if (maxConf < 0.6) {
    try {
      await c.sb.from("building_feedback").insert({
        building_id: c.building.id,
        canal: "eval_detector_v11",
        dimension: "n_escaleras",
        estado: "pendiente",
        texto: `v11 split baja confianza (max=${maxConf}). nMax=${nMax}, pages=${pool.length}`.slice(0, 1000),
        metadatos: { variant: "v11_split_per_page", n: nMax, max_conf: maxConf, samples: pool } as any,
      });
    } catch (_) {}
    const s = await VARIANTS_ESCALERAS.v1_subparcelas_only(c);
    if (typeof s === "number" && s >= 1) return Math.max(nMax, s);
  }
  return nMax;
};

async function callVlmSinglePage(c: Ctx, url: string): Promise<{ n: number; conf: number | null } | null> {
  const PROMPT = `Eres un experto en planos FXCC del Catastro de Madrid.
Recibes UNA SOLA página del FXCC. Tarea:
1) Identifica si esta página es "PISO 01" / "PLANTA 01" / "PLANTA 1ª". Si NO lo es
   (planta baja, sótano, ático, alzados, secciones, portada), responde n=1 y
   confidence=0.1 (página no relevante).
2) Si SÍ es piso 01: cuenta las cajas de escalera (ESC) — recintos cerrados
   rectangulares separando bloques V.A.* y V.B.*. Pistas: 2 portales, edificio
   en chaflán o doble fachada → suelen indicar 2 escaleras. Si SOLO ves 1
   núcleo claro y todas las viviendas son V.A.*, entonces n=1.
- NUNCA cuentes sobre planta baja.
- Si dudas en una página que es P01, devuelve tu mejor estimación con
  confidence entre 0.4 y 0.6.

Responde SOLO JSON: {"es_piso01": boolean, "n_escaleras_piso01": number, "confidence": number}`;
  try {
    const j = await gatewayChat(c.apiKey, {
      model: "google/gemini-3.1-pro-preview",
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url } },
      ]}],
      response_format: { type: "json_object" },
    });
    if (!j) return null;
    const txt = j?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(txt);
    const n = Math.max(1, Math.min(8, Math.round(Number(parsed?.n_escaleras_piso01 ?? 1))));
    const conf = parsed?.confidence != null ? Number(parsed.confidence) : null;
    return isFinite(n) ? { n, conf } : null;
  } catch { return null; }
}

async function callVlmRouterInverso(c: Ctx, ctx: { sub: number | null; esquina: boolean }): Promise<{ n: number; confidence: number | null } | null> {
  const pages: string[] = Array.isArray(c.cat?.fxcc_pages_urls) && c.cat.fxcc_pages_urls.length
    ? c.cat.fxcc_pages_urls
    : (Array.isArray(c.cat?.plantas_pages_urls) ? c.cat.plantas_pages_urls : []);
  if (!pages.length) return null;
  const PROMPT = `Eres un experto en planos FXCC del Catastro de Madrid.
CONTEXTO ARQUITECTÓNICO (señales fiables del Catastro):
- n_subparcelas_residenciales (loint.es distintos) = ${ctx.sub ?? "?"}
- esquina/chaflán/multifachada = ${ctx.esquina}
Con estas dos señales, el PRIOR del sistema es que hay 2 ESCALERAS (cajas ESC en PISO 01).

TAREA INVERTIDA: localiza el PISO 01 y JUSTIFICA POR QUÉ NO HAY 2 CAJAS si crees
que sólo hay 1. Si encuentras evidencia clara de 2 (dos núcleos, V.A.* y V.B.*,
dos portales en PB), confirma n=2. Por defecto, si las cajas se ven pegadas o el
plano es pequeño, hay 2 (no las colapses en 1).

Reglas estrictas:
- Sólo devuelve n=1 si TODAS las viviendas son del mismo bloque (sólo V.A.* sin V.B.*)
  y sólo hay 1 portal en planta baja. En cualquier otro caso, n>=2.
- Si dudas, n=2 con confidence<0.6 (se enviará a revisión humana).
- NUNCA cuentes escaleras sobre planta baja.

Responde SOLO JSON: {"n_escaleras_piso01": number, "razon_para_no_2": string, "confidence": number}`;
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
    const n = Math.max(1, Math.min(8, Math.round(Number(parsed?.n_escaleras_piso01 ?? 2))));
    const conf = parsed?.confidence != null ? Number(parsed.confidence) : null;
    return isFinite(n) ? { n, confidence: conf } : null;
  } catch { return null; }
}

// --- Image cropping helpers (Deno + imagescript) ---
async function fetchImage(url: string): Promise<Image | null> {
  return fetchImageImpl(url);
}

// --- Gateway chat con backoff exponencial: 5 intentos, base 1.5s, jitter,
// y respeto del header Retry-After cuando el gateway lo manda. Devuelve el
// JSON parseado del primer choice o null si todos los reintentos fallan.
async function gatewayChat(apiKey: string, body: unknown, maxAttempts = 5): Promise<any | null> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const j = await r.json();
        return j;
      }
      // Retryable: 408/425/429/5xx. 4xx (no 429) → no retry.
      const retryable = r.status === 408 || r.status === 425 || r.status === 429 || r.status >= 500;
      const ra = Number(r.headers.get("retry-after") ?? "0");
      try { await r.text(); } catch {}
      if (!retryable) return null;
      const waitMs = ra > 0
        ? Math.min(ra * 1000, 30_000)
        : Math.min(1500 * Math.pow(2, attempt - 1), 20_000) + Math.floor(Math.random() * 500);
      console.warn(`gatewayChat retry ${attempt}/${maxAttempts} after ${waitMs}ms (status=${r.status})`);
      await new Promise((res) => setTimeout(res, waitMs));
    } catch (e) {
      const waitMs = Math.min(1500 * Math.pow(2, attempt - 1), 20_000);
      console.warn(`gatewayChat exception retry ${attempt}: ${(e as Error).message}, wait ${waitMs}ms`);
      await new Promise((res) => setTimeout(res, waitMs));
    }
  }
  return null;
}

async function fetchImageImpl(url: string): Promise<Image | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    return await Image.decode(buf);
  } catch { return null; }
}

function toBase64Png(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(s)}`;
}

async function cropRegion(img: Image, x: number, y: number, w: number, h: number, zoom: number): Promise<string | null> {
  try {
    const c = img.clone().crop(x, y, w, h);
    const tw = Math.min(1600, Math.floor(w * zoom));
    const th = Math.min(1600, Math.floor(h * zoom));
    c.resize(tw, th);
    const out = await c.encode();
    return toBase64Png(out);
  } catch { return null; }
}

async function buildCropsForPage(url: string, esquina: boolean): Promise<{ images: string[]; tags: string[] }> {
  const img = await fetchImage(url);
  if (!img) return { images: [url], tags: ["original"] };
  const W = img.width, H = img.height;
  const out: string[] = [];
  const tags: string[] = [];
  // Center crop: 55% area, zoom 2x.
  const cw = Math.floor(W * 0.55), ch = Math.floor(H * 0.55);
  const cx = Math.floor((W - cw) / 2), cy = Math.floor((H - ch) / 2);
  const center = await cropRegion(img, cx, cy, cw, ch, 2);
  if (center) { out.push(center); tags.push("center_zoom2x"); }
  if (esquina) {
    // Crops de las 4 zonas de esquina (chaflán puede estar en cualquiera).
    const ew = Math.floor(W * 0.5), eh = Math.floor(H * 0.5);
    const corners: Array<[number, number, string]> = [
      [0, 0, "tl"], [W - ew, 0, "tr"], [0, H - eh, "bl"], [W - ew, H - eh, "br"],
    ];
    for (const [x, y, tag] of corners) {
      const c = await cropRegion(img, x, y, ew, eh, 1.8);
      if (c) { out.push(c); tags.push(`corner_${tag}`); }
    }
  }
  return { images: out, tags };
}

async function callVlmCropsZoom(c: Ctx): Promise<{ n: number; confidence: number | null; razonamiento?: string } | null> {
  const pages: string[] = Array.isArray(c.cat?.fxcc_pages_urls) && c.cat.fxcc_pages_urls.length
    ? c.cat.fxcc_pages_urls
    : (Array.isArray(c.cat?.plantas_pages_urls) ? c.cat.plantas_pages_urls : []);
  if (!pages.length) return null;
  const esquina = c.ba?.esquina === true;

  // Limitar a primeras ~6 páginas para no explotar tokens; P01 suele estar entre las primeras.
  const targetPages = pages.slice(0, 6);
  const imageParts: Array<{ type: "image_url"; image_url: { url: string } }> = [];
  const tagsAll: string[] = [];
  for (let i = 0; i < targetPages.length; i++) {
    const u = targetPages[i];
    imageParts.push({ type: "image_url", image_url: { url: u } });
    tagsAll.push(`pag${i + 1}_original`);
    const { images, tags } = await buildCropsForPage(u, esquina);
    for (let k = 0; k < images.length; k++) {
      imageParts.push({ type: "image_url", image_url: { url: images[k] } });
      tagsAll.push(`pag${i + 1}_${tags[k]}`);
    }
  }

  const PROMPT = `Eres un experto en planos FXCC del Catastro de Madrid.
TAREA: contar cajas de escalera (ESC) en PISO 01.

Te paso, por cada página relevante: la imagen ORIGINAL, una versión RECORTADA Y
AMPLIADA del CENTRO (zoom 2x) y, si el edificio es en ESQUINA/CHAFLÁN, también
RECORTES de las 4 esquinas del plano (donde a menudo está la 2ª caja en
edificios en chaflán). Usa los recortes para distinguir 1 vs 2 cajas cuando el
plano original es pequeño o las cajas están pegadas.

Reglas:
- Localiza la página "PISO 01" / "PLANTA 01" / "PLANTA 1ª".
- Una caja ESC = recinto cerrado rectangular separando bloques V.A.* / V.B.*.
- NUNCA cuentes sobre planta baja.
- 2 grupos de viviendas (V.A vs V.B), 2 portales, chaflán o doble fachada
  → suelen indicar 2 escaleras.
- Si en el zoom central ves UN solo núcleo claro y todas las viviendas son
  V.A.*, entonces n=1 incluso si esquina_chaflan=true.
- Marca confidence<0.6 si las cajas no se distinguen claramente.

EJEMPLOS:
- Serrano 16: 2 cajas (ESC_A norte, ESC_B sur), V.A y V.B → n=2.
- Cava Baja 42: chaflán con 2 portales independientes, 2 núcleos aunque pegados → n=2.
- Postigo de San Martín 6: 2 ESC simétricas en PISO 01 → n=2.
- Bloque lineal con 1 portal y V.A.* únicamente → n=1.

esquina_chaflan_prior = ${esquina}

Responde SOLO con JSON:
{"n_escaleras_piso01": number, "razonamiento": string, "confidence": number, "vio_chaflan": boolean}`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-pro-preview",
        messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, ...imageParts] }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(txt);
    const n = Math.max(1, Math.min(8, Math.round(Number(parsed?.n_escaleras_piso01 ?? 1))));
    const conf = parsed?.confidence != null ? Number(parsed.confidence) : null;
    return isFinite(n) ? { n, confidence: conf, razonamiento: parsed?.razonamiento } : null;
  } catch { return null; }
}

async function callVlmFocused(c: Ctx, fewshot: boolean): Promise<number | null> {
  const r = await callVlmFocusedFull(c, fewshot);
  return r ? r.n : null;
}

async function callVlmFocusedFull(c: Ctx, fewshot: boolean): Promise<{ n: number; confidence: number | null } | null> {
  return callVlmFocusedFullModel(c, fewshot, "google/gemini-3.1-pro-preview");
}

async function callVlmFocusedFullModel(c: Ctx, fewshot: boolean, model: string): Promise<{ n: number; confidence: number | null } | null> {
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
    const j = await gatewayChat(c.apiKey, {
      model,
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT },
        ...pages.map((url) => ({ type: "image_url", image_url: { url } })),
      ]}],
      response_format: { type: "json_object" },
    });
    if (!j) return null;
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