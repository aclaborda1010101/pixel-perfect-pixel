// escaleras-visor-madrid
// Cuenta nº de escaleras de un edificio PROTEGIDO leyendo el croquis
// "Análisis de la Edificación" del Catálogo PG97 del Visor Urbanístico de Madrid.
// Flujo:
//   1. Visor IDEAM → aceptar modal.
//   2. Buscar dirección → seleccionar parcela.
//   3. Herramienta info (i) → click parcela → "Ordenación: N".
//   4. Hook window.open + click → "Información Vigente".
//   5. Pestaña "Protección del Patrimonio" → "Catálogo PG97" (capturamos Nº Catálogo, Manzana, Grado).
//   6. "Análisis de la Edificación" → URL del PDF (tipoDoc=ANEDIF).
//   7. Descarga PDF dentro del page context (cookies de sesión).
//   8. Render PNG alta resolución → VLM (Lovable AI Gateway, mismo patrón que analyze-building-vision).
//   9. Persiste en building_analysis y recompute_cluster_score.
//
// Sin crons. Bajo demanda. Sólo edificios protegidos.

import { corsHeaders, err, getServiceClient, json, sleep } from "../_shared/scoring_v2_common.ts";

const RAW_WSS = Deno.env.get("BROWSER_WSS_URL") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

function toPuppeteerWss(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    u.pathname = "/";
    return u.toString().replace(/\/$/, "") + (u.search ? "" : "");
  } catch { return raw; }
}
const BROWSER_WSS_URL = toPuppeteerWss(RAW_WSS);

// deno-lint-ignore no-explicit-any
let _mupdf: any = null;
async function getMupdf() {
  if (_mupdf) return _mupdf;
  _mupdf = await import("npm:mupdf@1.3.0");
  return _mupdf;
}

// ---------- helpers ----------

function normalizeDireccionForVisor(direccion: string): string[] {
  const variants = new Set<string>();
  const d = (direccion || "").trim();
  if (!d) return [];
  variants.add(d);
  // "Serrano 8" → "calle de Serrano 8"
  if (!/^(calle|c\/|avda|avenida|paseo|plaza|pza|gran v[ií]a)/i.test(d)) {
    variants.add(`calle de ${d}`);
    variants.add(`calle ${d}`);
  }
  // quita ", Madrid"
  variants.add(d.replace(/,\s*madrid.*$/i, "").trim());
  return [...variants].filter(Boolean);
}

async function rasterizePdf(buf: Uint8Array, maxPages = 4, scale = 4): Promise<Uint8Array[]> {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const n = Math.min(doc.countPages(), maxPages);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    out.push(pixmap.asPNG());
    pixmap.destroy();
    page.destroy();
  }
  doc.destroy();
  return out;
}

const VLM_PROMPT = (catalogo: string | null, calle: string, numero: string | null) => `Eres un experto en lectura de planos catastrales de Madrid (Catálogo PG97).

En este croquis "Análisis de la Edificación" del Catálogo PG97 verás la MANZANA entera con varias parcelas rotuladas por Nº de Catálogo y las CALLES rotuladas alrededor (en los lados de la manzana).

TAREA: localiza ÚNICAMENTE la parcela con:
- Nº de Catálogo: ${catalogo ?? "(desconocido — usa el número de policía)"}
- Calle: ${calle}
- Nº de policía: ${numero ?? "(desconocido)"}

Sobre ESA parcela:
(a) Cuenta sus CAJAS DE ESCALERA dentro de sus límites.
    - CAJA DE ESCALERA = recuadro con PELDAÑOS dibujados (líneas paralelas finas, a veces dos tramos con meseta, a veces envolviendo el hueco del ascensor que es un cuadradito). Dos tramos con meseta de UNA misma caja = 1 escalera, NO 2.
    - PATIO de luces = recuadro con una X (aspa). NO es escalera, anótalo en patios_vistos.
    - NO cuentes núcleos de parcelas vecinas.
(b) Determina a qué CALLES da la parcela: mira qué lados de la parcela limitan con vías ROTULADAS en el plano. Devuélvelas tal y como aparecen escritas (ej: "Calle de Serrano", "Calle de Goya"). Si solo da a una calle, devuelve esa única calle.

es_esquina = true si la parcela limita con DOS o más calles distintas rotuladas; false si solo da a una.

Devuelve JSON estricto:
{
  "n_escaleras": <int>,
  "confianza": <0..1>,
  "patios_vistos": <int>,
  "calles_frente": [<string>, ...],
  "es_esquina": <bool>,
  "confianza_esquina": <0..1>,
  "razonamiento": "<explica brevemente cómo identificaste la parcela, dónde está cada caja y a qué calles da>"
}`;

async function callVLM(imageUrls: string[], prompt: string): Promise<{ parsed: any; modelo_usado: string; modelo_fallback: boolean; raw: any; lastErr: string | null }> {
  const buildPayload = (model: string) => ({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    }],
    response_format: { type: "json_object" },
  });

  const primaryModel = "google/gemini-3.1-pro-preview";
  const fallbackModel = "google/gemini-2.5-pro";
  let modelo_usado = primaryModel;
  let modelo_fallback = false;
  let parsed: any = null;
  let llm_raw: any = null;
  let lastErr: string | null = null;

  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(primaryModel)),
      });
      if (r.status === 429 || r.status === 402) { lastErr = `gateway ${r.status}`; await sleep(2000 * (attempt + 1)); continue; }
      const j = await r.json();
      llm_raw = j;
      const txt = j?.choices?.[0]?.message?.content ?? "";
      try { parsed = JSON.parse(txt); } catch { lastErr = "JSON inválido (primario)"; }
    } catch (e) { lastErr = String((e as Error).message ?? e); await sleep(2000 * (attempt + 1)); }
  }

  if (!parsed) {
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(fallbackModel)),
        });
        if (r.status === 429 || r.status === 402) { lastErr = `gateway ${r.status} (fallback)`; await sleep(3000 * (attempt + 1)); continue; }
        const j = await r.json();
        llm_raw = j;
        const txt = j?.choices?.[0]?.message?.content ?? "";
        try { parsed = JSON.parse(txt); modelo_usado = fallbackModel; modelo_fallback = true; }
        catch { lastErr = "JSON inválido (fallback)"; }
      } catch (e) { lastErr = String((e as Error).message ?? e); await sleep(3000 * (attempt + 1)); }
    }
  }

  return { parsed, modelo_usado, modelo_fallback, raw: llm_raw, lastErr };
}

// ---------- AGENTE CON VISIÓN ----------
// visionAsk: pasa imágenes (URLs públicas o data: URLs) + prompt al gateway y exige JSON.
async function visionAsk(images: string[], prompt: string, opts?: { maxTokens?: number; primary?: string; fallback?: string }): Promise<{ parsed: any; modelo_usado: string; lastErr: string | null }> {
  const primary = opts?.primary ?? "google/gemini-3.1-pro-preview";
  const fallback = opts?.fallback ?? "google/gemini-2.5-pro";
  const buildPayload = (model: string) => ({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    }],
    response_format: { type: "json_object" },
    ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  });
  let lastErr: string | null = null;
  for (const model of [primary, fallback]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(model)),
        });
        if (r.status === 429 || r.status === 402) { lastErr = `gateway ${r.status} (${model})`; await sleep(1500 * (attempt + 1)); continue; }
        const j = await r.json();
        const txt = j?.choices?.[0]?.message?.content ?? "";
        try { return { parsed: JSON.parse(txt), modelo_usado: model, lastErr: null }; }
        catch { lastErr = `JSON inválido (${model}): ${txt.slice(0, 120)}`; }
      } catch (e) { lastErr = `${model}: ${String((e as Error).message ?? e)}`; await sleep(1500); }
    }
  }
  return { parsed: null, modelo_usado: primary, lastErr };
}

// visionAct: agente bucle screenshot→VLM→ejecuta. Devuelve { ok, log, attempts }.
type VisionActLog = { attempt: number; action: string; x?: number; y?: number; text?: string; reason: string }[];
async function visionAct(page: any, objetivo: string, opts?: { maxAttempts?: number; viewport?: { w: number; h: number }; postClickWaitMs?: number }) {
  const maxAttempts = opts?.maxAttempts ?? 6;
  const vw = opts?.viewport?.w ?? 1280;
  const vh = opts?.viewport?.h ?? 900;
  const wait = opts?.postClickWaitMs ?? 1800;
  const log: VisionActLog = [];
  for (let i = 0; i < maxAttempts; i++) {
    let b64: string;
    try {
      b64 = await page.screenshot({ encoding: "base64", type: "png", clip: { x: 0, y: 0, width: vw, height: vh } });
    } catch (e) {
      log.push({ attempt: i, action: "screenshot_fail", reason: String((e as Error).message ?? e) });
      return { ok: false, log };
    }
    const dataUrl = `data:image/png;base64,${b64}`;
    const prompt = `Eres un agente que opera un visor web (Visor Urbanístico de Madrid). Tienes una captura de ${vw}x${vh} px (origen 0,0 arriba-izquierda).

OBJETIVO: ${objetivo}

Decide UNA acción para acercarte al objetivo. Coordenadas en píxeles ENTEROS dentro del rango [0,${vw}) x [0,${vh}).

Acciones posibles (devuelve UNA):
- {"action":"click","x":<int>,"y":<int>,"reason":"..."}
- {"action":"type","x":<int>,"y":<int>,"text":"<texto>","reason":"..."}  (clica primero, luego escribe)
- {"action":"scroll","x":<int>,"y":<int>,"deltaY":<int>,"reason":"..."}
- {"action":"done","reason":"objetivo cumplido"}
- {"action":"fail","reason":"no se puede cumplir"}

Devuelve SOLO el JSON, sin texto extra.`;
    // Para el bucle agente usamos modelos Flash (más baratos). Pro queda para el croquis.
    const r = await visionAsk([dataUrl], prompt, {
      maxTokens: 400,
      primary: "google/gemini-3-flash-preview",
      fallback: "google/gemini-2.5-flash",
    });
    if (!r.parsed) {
      log.push({ attempt: i, action: "vlm_fail", reason: r.lastErr ?? "vlm sin respuesta" });
      return { ok: false, log };
    }
    const a = r.parsed as any;
    const action = String(a.action ?? "").toLowerCase();
    const reason = String(a.reason ?? "").slice(0, 240);
    const x = Math.max(0, Math.min(vw - 1, Number.parseInt(String(a.x ?? 0), 10) || 0));
    const y = Math.max(0, Math.min(vh - 1, Number.parseInt(String(a.y ?? 0), 10) || 0));
    log.push({ attempt: i, action, x, y, text: a.text, reason });
    if (action === "done") return { ok: true, log };
    if (action === "fail") return { ok: false, log };
    try {
      if (action === "click") {
        await page.mouse.click(x, y);
      } else if (action === "type") {
        await page.mouse.click(x, y);
        await sleep(300);
        if (a.text) await page.keyboard.type(String(a.text), { delay: 25 });
      } else if (action === "scroll") {
        const dy = Number.parseInt(String(a.deltaY ?? 300), 10) || 300;
        await page.mouse.move(x, y);
        await page.mouse.wheel({ deltaY: dy });
      } else {
        log.push({ attempt: i, action: "unknown", reason: `acción no soportada: ${action}` });
        return { ok: false, log };
      }
    } catch (e) {
      log.push({ attempt: i, action: "exec_fail", reason: String((e as Error).message ?? e) });
      return { ok: false, log };
    }
    await sleep(wait);
  }
  log.push({ attempt: maxAttempts, action: "timeout", reason: "max attempts alcanzado" });
  return { ok: false, log };
}

// Recolector global de URLs vistas en red (peticiones de la página principal y de
// cualquier popup que el Visor abra con window.open). Independiente de cómo se
// dispare la navegación: cubre popup nativo, navegación in-place y XHR/fetch.
type UrlRecorder = {
  urls: string[];
  reset: () => void;
  waitFor: (regex: RegExp, timeoutMs?: number) => Promise<string | null>;
  closeExtraPages: () => Promise<void>;
};

async function attachUrlRecorder(browser: any, page: any): Promise<UrlRecorder> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const rec = (u: string | undefined | null) => {
    if (!u) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  page.on("request", (r: any) => { try { rec(r.url()); } catch (_) {} });
  page.on("framenavigated", (f: any) => { try { rec(f.url()); } catch (_) {} });
  page.on("popup", (p: any) => {
    try { rec(p.url()); } catch (_) {}
    try { p.on("request", (r: any) => { try { rec(r.url()); } catch (_) {} }); } catch (_) {}
    try { p.on("framenavigated", (f: any) => { try { rec(f.url()); } catch (_) {} }); } catch (_) {}
  });
  // puppeteer: nuevas pestañas vía targetcreated
  try {
    browser.on("targetcreated", async (target: any) => {
      try {
        const p = await target.page();
        if (!p || p === page) return;
        rec(p.url());
        p.on("request", (r: any) => { try { rec(r.url()); } catch (_) {} });
        p.on("framenavigated", (f: any) => { try { rec(f.url()); } catch (_) {} });
      } catch (_) {}
    });
  } catch (_) {}

  return {
    urls,
    reset() { urls.length = 0; seen.clear(); },
    async waitFor(regex: RegExp, timeoutMs = 12000) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        const hit = urls.find((u) => regex.test(u));
        if (hit) return hit;
        await sleep(250);
      }
      return null;
    },
    async closeExtraPages() {
      try {
        const pages = await browser.pages();
        for (const p of pages) {
          if (p !== page) { try { await p.close(); } catch (_) {} }
        }
      } catch (_) {}
    },
  };
}

// Click en cualquier elemento cuyo texto contenga `needle` (case-insensitive).
async function clickByText(page: any, needle: string): Promise<boolean> {
  return await page.evaluate((needleArg: string) => {
    const NEEDLE = needleArg.toLowerCase();
    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const all = Array.from(document.querySelectorAll("a,button,span,div,td,li"));
    for (const el of all) {
      const t = (el.textContent ?? "").trim().toLowerCase();
      if (t && t.includes(NEEDLE) && isVisible(el)) {
        (el as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, needle);
}

// Click en el <a title="...formulario de detalle..."> de "Ordenación: N"
async function clickOrdenacionLink(page: any): Promise<boolean> {
  return await page.evaluate(() => {
    const isVisible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[title]"));
    for (const a of links) {
      const t = (a.getAttribute("title") || "").toLowerCase();
      if (t.includes("formulario de detalle") && isVisible(a)) {
        a.click();
        return true;
      }
    }
    return false;
  });
}

// ---------- procesa un edificio ----------

type StepLog = { step: string; ok: boolean; note?: string; detail?: any };

async function processBuilding(building_id: string, opts?: { force?: boolean }) {
  const sb = getServiceClient();
  const steps: StepLog[] = [];
  const log = (s: StepLog) => { steps.push(s); console.log("[visor]", building_id, s.step, s.ok ? "OK" : "FAIL", s.note ?? ""); };

  const { data: b } = await sb.from("buildings").select("id, direccion, ciudad, refcatastral").eq("id", building_id).maybeSingle();
  if (!b) return { ok: false, building_id, error: "building_not_found", steps };

  const { data: ba0 } = await sb.from("building_analysis").select("protegido_historicamente, n_escaleras_visor, escaleras_visor_at").eq("building_id", building_id).maybeSingle();

  const protegido = (ba0 as any)?.protegido_historicamente === true;
  if (!protegido && !opts?.force) {
    return { ok: true, building_id, skipped: "no_protegido", direccion: b.direccion };
  }

  if (!BROWSER_WSS_URL) return { ok: false, building_id, error: "BROWSER_WSS_URL_missing" };
  if (!LOVABLE_API_KEY) return { ok: false, building_id, error: "LOVABLE_API_KEY_missing" };

  const puppeteer = (await import("npm:puppeteer-core@22.15.0")).default;
  let browser: any = null;
  let page: any = null;
  const result: any = {
    building_id,
    direccion: b.direccion,
    n_escaleras_visor: null as number | null,
    confianza: null as number | null,
    catalogo: null as string | null,
    manzana: null as string | null,
    grado: null as string | null,
    razonamiento: null as string | null,
    patios_vistos: null as number | null,
    doc_url: null as string | null,
    motivo: null as string | null,
    modelo_usado: null as string | null,
    es_esquina_visor: null as boolean | null,
    calles_frente_visor: null as string[] | null,
    esquina_visor_confianza: null as number | null,
    last_vision_objective: null as string | null,
    last_vision_log: null as any,
  };

  try {
    browser = await puppeteer.connect({ browserWSEndpoint: BROWSER_WSS_URL });
    page = await browser.newPage();
    page.setDefaultTimeout(45000);
    await page.setViewport({ width: 1280, height: 900 });
    const VW = 1280, VH = 900;

    const recorder = await attachUrlRecorder(browser, page);

    // Helper para registrar el último objetivo de visionAct (útil para reportar fallos)
    const runVision = async (objetivo: string, opts?: any) => {
      result.last_vision_objective = objetivo;
      const r = await visionAct(page, objetivo, { viewport: { w: VW, h: VH }, ...(opts ?? {}) });
      result.last_vision_log = r.log;
      log({ step: `vision:${objetivo.slice(0, 60)}`, ok: r.ok, note: JSON.stringify(r.log).slice(0, 600) });
      return r;
    };

    // 1. Visor
    await page.goto("https://servpub.madrid.es/IDEAM_WBGEOPORTAL/visor_din.iam?clave=VSURB", { waitUntil: "networkidle2", timeout: 60000 });
    // Espera a que el WebAppBuilder termine de cargar (el loader desaparece)
    try {
      await page.waitForFunction(() => {
        const ld = document.getElementById("main-loading");
        if (!ld) return true;
        const cs = getComputedStyle(ld);
        return cs.display === "none" || cs.visibility === "hidden" || ld.offsetHeight === 0;
      }, { timeout: 60000, polling: 1000 });
    } catch (_) { /* sigue, el diag lo confirma */ }
    await sleep(8000);
    const pageDiag = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyHTML: (document.body?.outerHTML || "").slice(0, 600),
      iframes: Array.from(document.querySelectorAll("iframe")).map((f) => ({ src: (f as HTMLIFrameElement).src, id: f.id, name: (f as HTMLIFrameElement).name, hasSrcdoc: !!(f as HTMLIFrameElement).srcdoc })).slice(0, 5),
    }));
    log({ step: "visor_loaded", ok: true, note: JSON.stringify(pageDiag).slice(0, 500) });

    // 2. Aceptar aviso(s) modal(es) — puede haber 1 o 2 splash. Usa selectores y, si quedan modales, visión.
    await sleep(1500);
    for (let i = 0; i < 8; i++) {
      const did = await clickByText(page, "aceptar") || await clickByText(page, "acepto");
      if (!did) break;
      await sleep(900);
    }
    // Si todavía hay un splash visible (no hay widgets clicables), pide a la visión que lo cierre.
    const stillModal = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.dijitDialog,[role="dialog"],.jimu-dialog,.splash'));
      return dialogs.some((d) => d.offsetWidth > 100 && d.offsetHeight > 50 && getComputedStyle(d).display !== "none");
    });
    log({ step: "modal_aceptar", ok: !stillModal, note: stillModal ? "queda modal — vision fallback" : "limpio" });
    if (stillModal) {
      await runVision("Cierra cualquier aviso/splash/modal pulsando 'Aceptar', 'Acepto', 'Cerrar' o la X de cierre. Cuando NO quede ningún diálogo modal en pantalla y se vea el mapa con los iconos de widgets en la esquina, devuelve done.", { maxAttempts: 5 });
    }

    // 3. Buscar dirección — primero por selectores nativos; si falla, agente con visión.
    const variants = normalizeDireccionForVisor(b.direccion);
    let searched = false; let usedQuery = "";
    await sleep(2500);
    // Intenta selectores rápidos
    for (const q of variants) {
      const typed = await page.evaluate((qq: string) => {
        const candidates = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
        const visible = (i: HTMLInputElement) => i.getBoundingClientRect().width > 0;
        const target = candidates.find((i) => i.id === "esri_dijit_Search_0_input" && visible(i))
          || candidates.find((i) => (i.className || "").toLowerCase().includes("searchinput") && visible(i))
          || candidates.find((i) => ((i.placeholder || "").toLowerCase()).includes("buscar") && visible(i));
        if (!target) return false;
        target.focus();
        target.value = qq;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: qq.slice(-1) }));
        return true;
      }, q);
      if (!typed) continue;
      await sleep(2500);
      const picked = await page.evaluate(() => {
        const li = document.querySelector(".searchMenu li, .suggestionsMenu li, .esriSuggestList li, [class*=suggest] li") as HTMLElement | null;
        if (li) { li.click(); return true; }
        return false;
      });
      if (picked) { searched = true; usedQuery = q; break; }
      try { await page.keyboard.press("Enter"); } catch (_) {}
      await sleep(2500);
    }
    // Fallback con visión
    if (!searched) {
      const dirText = variants[0] ?? b.direccion;
      const r1 = await runVision(`Abre el widget de búsqueda (icono de lupa, normalmente arriba-derecha o en la barra de widgets). Cuando aparezca una caja de texto donde se pueda escribir, devuelve done.`, { maxAttempts: 4 });
      if (r1.ok) {
        const r2 = await runVision(`Escribe la dirección "${dirText}" en la caja de búsqueda y selecciona la primera sugerencia que coincida con esa dirección en Madrid (haz click en el item del autocompletado). Cuando el mapa haga zoom y aparezca un pin centrado en la parcela buscada, devuelve done.`, { maxAttempts: 6, postClickWaitMs: 2500 });
        searched = r2.ok;
        usedQuery = dirText;
      }
    }
    log({ step: "buscar_direccion", ok: searched, note: usedQuery });
    if (!searched) { result.motivo = "no_se_pudo_buscar_direccion"; return { ok: false, ...result, steps }; }
    await sleep(4000);

    // El Visor abre a veces un popup "Resultado" tras el autocompletado. Ciérralo.
    await recorder.closeExtraPages();
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll<HTMLElement>('[title="Cerrar"],.dijitDialogCloseIcon,.jimu-icon-close'));
      for (const b of btns) { const r = b.getBoundingClientRect(); if (r.width > 0) b.click(); }
    });
    await sleep(800);
    // Si todavía hay un popup tipo "Resultado" tapando el mapa, ciérralo con visión.
    const blocking = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.dijitDialog,[role="dialog"]'));
      return dialogs.some((d) => d.offsetWidth > 200 && d.offsetHeight > 100 && getComputedStyle(d).display !== "none");
    });
    if (blocking) {
      await runVision("Cierra el popup llamado 'Resultado' (o cualquier diálogo que tape el mapa) pulsando su X o botón Cerrar. Cuando se vea el mapa libre, devuelve done.", { maxAttempts: 3 });
    }

    // 4. Activar herramienta "Identificación de Entidades" y click parcela en el centro del mapa
    let infoActivado = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[title]'));
      const info = els.find((e) => {
        const t = (e.getAttribute('title') || '').toLowerCase();
        return t.includes('identificación de entidades') || t.includes('identificacion de entidades');
      });
      if (info) { (info as HTMLElement).click(); return true; }
      return false;
    });
    if (!infoActivado) {
      const r = await runVision("Activa la herramienta 'Identificación de Entidades' (icono de la 'i' de información, normalmente entre los widgets de la barra de herramientas). Cuando el cursor esté en modo identificar (suele cambiar el icono activo), devuelve done.", { maxAttempts: 4 });
      infoActivado = r.ok;
    }
    log({ step: "info_tool", ok: infoActivado });
    await sleep(1500);

    // El pin queda centrado; click en el centro del viewport.
    await page.mouse.click(Math.floor(VW / 2), Math.floor(VH / 2));
    await sleep(4000);
    // Si no aparece el panel "Identificación" con resultados, intenta con visión clicar la parcela del pin.
    const hasIdent = await page.evaluate(() => {
      const txt = (document.body?.innerText || "").toLowerCase();
      return txt.includes("ordenación") || txt.includes("ordenacion");
    });
    if (!hasIdent) {
      await runVision("Tras buscar la dirección, hay un PIN rojo/azul centrado en el mapa señalando la parcela. Con la herramienta de Identificación ya activa, haz click EXACTAMENTE sobre la parcela del pin (en el polígono del edificio, no en la calle). Cuando aparezca un panel lateral con campos como 'Ordenación: ...', devuelve done.", { maxAttempts: 4, postClickWaitMs: 2500 });
    }

    // 5. Click "Ordenación: N" (intercepción por red — abre popup nativo).
    recorder.reset();
    let ordenacionClick = await clickOrdenacionLink(page);
    if (!ordenacionClick) {
      // fallback por texto
      ordenacionClick = await clickByText(page, "ordenación") || await clickByText(page, "ordenacion");
    }
    if (!ordenacionClick) {
      const r = await runVision("En el panel lateral 'Identificación de Entidades' verás un campo 'Ordenación: <número>' donde el número es un enlace. Haz click EN ESE NÚMERO/ENLACE de Ordenación (no en otros campos). Cuando se abra una nueva ficha de detalle, devuelve done.", { maxAttempts: 4 });
      ordenacionClick = r.ok;
    }
    log({ step: "click_ordenacion", ok: ordenacionClick });
    if (!ordenacionClick) { result.motivo = "no_click_ordenacion"; return { ok: false, ...result, steps }; }
    const ordenacionUrl = await recorder.waitFor(/infoUrbanisticaVigenteIndex/i, 15000);
    log({ step: "url_ordenacion", ok: !!ordenacionUrl, note: ordenacionUrl?.slice(0, 140) });
    if (!ordenacionUrl) { result.motivo = "no_se_capturo_url_ordenacion"; return { ok: false, ...result, steps }; }
    await recorder.closeExtraPages();
    await page.goto(ordenacionUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1500);

    // 6. Pestaña Protección del Patrimonio → Catálogo PG97
    let proteccion = await clickByText(page, "protección del patrimonio");
    if (!proteccion) proteccion = await clickByText(page, "proteccion del patrimonio");
    if (!proteccion) proteccion = await clickByText(page, "patrimonio");
    log({ step: "tab_proteccion", ok: proteccion });
    await sleep(1500);

    recorder.reset();
    const pg97 = await clickByText(page, "catálogo pg97") || await clickByText(page, "catalogo pg97") || await clickByText(page, "pg97");
    log({ step: "click_pg97", ok: pg97 });
    if (!pg97) {
      result.motivo = "sin catalogo pg97 / no protegido por esta via";
      return { ok: true, ...result, steps };
    }
    const pg97Url = await recorder.waitFor(/infoPg97\.iam/i, 15000);
    log({ step: "url_pg97", ok: !!pg97Url, note: pg97Url?.slice(0, 140) });
    if (!pg97Url) { result.motivo = "no_se_capturo_url_pg97"; return { ok: false, ...result, steps }; }
    await recorder.closeExtraPages();
    await page.goto(pg97Url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1500);

    // Extraer Nº Catálogo, Manzana, Grado del HTML
    const meta = await page.evaluate(() => {
      const txt = document.body.innerText || "";
      const m1 = txt.match(/N[ºoO\.]?\s*de?\s*Cat[áa]logo[:\s]+([0-9A-Z\-\/]+)/i);
      const m2 = txt.match(/N[ºoO\.]?\s*de?\s*Manzana[:\s]+([0-9A-Z\-\/]+)/i);
      const m3 = txt.match(/Grado\s*(?:de)?\s*Protecci[óo]n[:\s]+([^\n\r]+)/i);
      return {
        catalogo: m1 ? m1[1].trim() : null,
        manzana: m2 ? m2[1].trim() : null,
        grado: m3 ? m3[1].trim().slice(0, 80) : null,
      };
    });
    result.catalogo = meta.catalogo; result.manzana = meta.manzana; result.grado = meta.grado;
    log({ step: "meta_pg97", ok: !!meta.catalogo, detail: meta });

    // 7. Click "Análisis de la Edificación" → captura URL del PDF por red, NO navegues
    recorder.reset();
    const anedif = await clickByText(page, "análisis de la edificación") || await clickByText(page, "analisis de la edificacion") || await clickByText(page, "análisis de la edif") || await clickByText(page, "analisis de la edif");
    log({ step: "click_anedif", ok: anedif });
    if (!anedif) {
      result.motivo = "sin catalogo pg97 / no protegido por esta via";
      return { ok: true, ...result, steps };
    }
    const pdfUrl = await recorder.waitFor(/getDocumento.*tipoDoc=ANEDIF/i, 15000)
      ?? await recorder.waitFor(/getDocumento/i, 5000);
    if (!pdfUrl) {
      result.motivo = "no_pdf_url_capturada";
      return { ok: false, ...result, steps };
    }
    await recorder.closeExtraPages();
    result.doc_url = pdfUrl;
    log({ step: "pdf_url", ok: true, note: pdfUrl.slice(0, 120) });

    // 8. Descargar PDF dentro del page context (cookies de sesión)
    const pdfB64: string = await page.evaluate(async (url: string) => {
      const r = await fetch(url, { credentials: "include" });
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
      return btoa(s);
    }, pdfUrl);
    const pdfBuf = Uint8Array.from(atob(pdfB64), (c) => c.charCodeAt(0));
    if (pdfBuf.length < 1000 || !(pdfBuf[0] === 0x25 && pdfBuf[1] === 0x50)) {
      result.motivo = "pdf_invalido"; return { ok: false, ...result, steps };
    }
    log({ step: "pdf_downloaded", ok: true, note: `${pdfBuf.length} bytes` });

    // 9. Render PNG alta resolución
    const pages = await rasterizePdf(pdfBuf, 4, 4);
    log({ step: "rasterized", ok: true, note: `${pages.length} pages` });

    // Subir páginas a storage para pasarlas al VLM como URL pública
    const imageUrls: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const path = `visor-pg97/${building_id}_anedif_p${i + 1}_${Date.now()}.png`;
      const up = await sb.storage.from("catastro").upload(path, pages[i], { contentType: "image/png", upsert: true });
      if (up.error) { console.warn("[visor] upload fail", up.error.message); continue; }
      const url = sb.storage.from("catastro").getPublicUrl(path).data.publicUrl;
      imageUrls.push(url);
    }
    if (imageUrls.length === 0) { result.motivo = "no_imagenes_subidas"; return { ok: false, ...result, steps }; }

    // Cierra el navegador antes de la llamada VLM (libera el slot de Browserless)
    try { await page.close(); } catch (_) {}
    try { await browser.disconnect(); browser = null; } catch (_) {}

    // 10. Llamar al VLM
    const numero = (b.direccion?.match(/\b(\d{1,4})\b/)?.[1]) ?? null;
    const calleSimple = (b.direccion ?? "").replace(/\b\d{1,4}\b.*$/, "").trim();
    const prompt = VLM_PROMPT(result.catalogo, calleSimple, numero);
    const vlm = await callVLM(imageUrls, prompt);
    if (!vlm.parsed) {
      result.motivo = "vlm_sin_resultado";
      return { ok: false, ...result, vlm_error: vlm.lastErr, steps };
    }
    result.modelo_usado = vlm.modelo_usado;
    const n = Number.parseInt(String(vlm.parsed.n_escaleras ?? 0), 10);
    const conf = Number.parseFloat(String(vlm.parsed.confianza ?? 0));
    result.n_escaleras_visor = Number.isFinite(n) ? n : null;
    result.confianza = Number.isFinite(conf) ? conf : null;
    result.razonamiento = String(vlm.parsed.razonamiento ?? "").slice(0, 4000);
    result.patios_vistos = Number.isFinite(Number(vlm.parsed.patios_vistos)) ? Number(vlm.parsed.patios_vistos) : null;
    // Esquina + calles_frente
    const callesArr = Array.isArray(vlm.parsed.calles_frente) ? (vlm.parsed.calles_frente as any[]).map((c) => String(c)).slice(0, 6) : [];
    result.calles_frente_visor = callesArr.length ? callesArr : null;
    if (typeof vlm.parsed.es_esquina === "boolean") result.es_esquina_visor = vlm.parsed.es_esquina;
    else if (callesArr.length) result.es_esquina_visor = callesArr.length >= 2;
    const cesq = Number.parseFloat(String(vlm.parsed.confianza_esquina ?? 0));
    result.esquina_visor_confianza = Number.isFinite(cesq) ? cesq : null;
    log({ step: "vlm_ok", ok: true, note: `n=${result.n_escaleras_visor} conf=${result.confianza} esq=${result.es_esquina_visor} calles=${callesArr.join("|")}` });

    // 11. Persistir en building_analysis (upsert por building_id)
    const patch: any = {
      building_id,
      n_escaleras_visor: result.n_escaleras_visor,
      escaleras_visor_confianza: result.confianza,
      escaleras_visor_catalogo: result.catalogo,
      escaleras_visor_grado: result.grado,
      escaleras_visor_source: "pg97_analisis_edificacion",
      escaleras_visor_at: new Date().toISOString(),
      es_esquina_visor: result.es_esquina_visor,
      calles_frente_visor: result.calles_frente_visor,
      esquina_visor_confianza: result.esquina_visor_confianza,
      escaleras_visor_raw: {
        razonamiento: result.razonamiento,
        patios_vistos: result.patios_vistos,
        manzana: result.manzana,
        catalogo: result.catalogo,
        grado: result.grado,
        doc_url: result.doc_url,
        modelo_usado: result.modelo_usado,
        modelo_fallback: vlm.modelo_fallback,
        prompt_v: 2,
        es_esquina: result.es_esquina_visor,
        calles_frente: result.calles_frente_visor,
        confianza_esquina: result.esquina_visor_confianza,
        steps,
      },
    };
    const { data: existing } = await sb.from("building_analysis").select("id").eq("building_id", building_id).maybeSingle();
    if (existing) await sb.from("building_analysis").update(patch).eq("building_id", building_id);
    else await sb.from("building_analysis").insert(patch);

    // Recompute cluster score con la nueva señal
    try { await sb.rpc("compute_cluster_score", { p_building_id: building_id }); } catch (e) { console.warn("recompute fail", e); }

    return { ok: true, ...result, steps };
  } catch (e: any) {
    console.error("[visor] error", e);
    return { ok: false, building_id, error: String(e?.message ?? e), steps };
  } finally {
    try { if (page) await page.close(); } catch (_) {}
    try { if (browser) await browser.disconnect(); } catch (_) {}
  }
}

// Persiste motivo "sin catalogo pg97" cuando proceda (sin escaleras detectadas).
async function persistSinCatalogo(sb: any, building_id: string, motivo: string, steps: StepLog[]) {
  const patch = {
    building_id,
    n_escaleras_visor: null,
    escaleras_visor_confianza: null,
    escaleras_visor_at: new Date().toISOString(),
    escaleras_visor_source: "pg97_analisis_edificacion",
    escaleras_visor_raw: { motivo, steps },
  } as any;
  const { data: existing } = await sb.from("building_analysis").select("id").eq("building_id", building_id).maybeSingle();
  if (existing) await sb.from("building_analysis").update(patch).eq("building_id", building_id);
  else await sb.from("building_analysis").insert(patch);
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  let body: any = {};
  try { body = await req.json(); } catch (_e) { /* empty ok */ }

  const sb = getServiceClient();

  // Resolver lista de building_ids
  let ids: string[] = [];
  if (body.building_id) ids = [String(body.building_id)];
  else if (Array.isArray(body.building_ids)) ids = body.building_ids.map(String);
  else if (body.batch === true) {
    const onlyProt = body.only_protegidos !== false;
    const limit = Math.min(Number(body.limit ?? 10), 50);
    let q = sb.from("buildings").select("id, building_analysis!inner(protegido_historicamente, n_escaleras_visor)").limit(limit);
    if (onlyProt) q = q.eq("building_analysis.protegido_historicamente", true);
    const { data, error } = await q;
    if (error) return err(error.message, 500);
    const rows = (data ?? []) as any[];
    ids = rows
      .filter((r) => body.force === true || !(r.building_analysis?.[0]?.n_escaleras_visor != null))
      .map((r) => r.id);
  }
  if (ids.length === 0) return json({ ok: true, processed: 0, note: "sin building_ids" });

  // Procesa serial (cada uno consume un slot de Browserless)
  const out: any[] = [];
  for (const id of ids) {
    const r = await processBuilding(id, { force: !!body.force });
    // Si motivo === sin catalogo, persistirlo
    if (r.ok && (r as any).motivo === "sin catalogo pg97 / no protegido por esta via") {
      try { await persistSinCatalogo(sb, id, (r as any).motivo, (r as any).steps ?? []); } catch (_e) { /* ignore */ }
    }
    out.push(r);
  }

  return json({ ok: true, processed: out.length, results: out });
});