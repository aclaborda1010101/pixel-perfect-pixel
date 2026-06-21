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

En este croquis "Análisis de la Edificación" del Catálogo PG97 verás la MANZANA entera con varias parcelas rotuladas por Nº de Catálogo.

TAREA: localiza ÚNICAMENTE la parcela con:
- Nº de Catálogo: ${catalogo ?? "(desconocido — usa el número de policía)"}
- Calle: ${calle}
- Nº de policía: ${numero ?? "(desconocido)"}

Dentro de los límites de ESA parcela cuenta las CAJAS DE ESCALERA.

REGLAS:
- CAJA DE ESCALERA = recuadro con PELDAÑOS dibujados (líneas paralelas finas, a veces en dos tramos alrededor de una meseta, a veces envolviendo el hueco del ascensor que es un cuadradito). Dos tramos con meseta de UNA misma caja = 1 escalera, NO 2.
- PATIO de luces = recuadro con una X (aspa). NO es escalera, NO lo cuentes (pero anota patios_vistos).
- NO cuentes núcleos de parcelas vecinas.

Devuelve JSON estricto:
{
  "n_escaleras": <int>,
  "confianza": <0..1>,
  "patios_vistos": <int>,
  "razonamiento": "<explica brevemente cómo identificaste la parcela y dónde está cada caja>"
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
  };

  try {
    browser = await puppeteer.connect({ browserWSEndpoint: BROWSER_WSS_URL });
    page = await browser.newPage();
    page.setDefaultTimeout(45000);
    await page.setViewport({ width: 1400, height: 900 });

    const recorder = await attachUrlRecorder(browser, page);

    // 1. Visor
    await page.goto("https://servpub.madrid.es/IDEAM_WBGEOPORTAL/visor_din.iam?clave=VSURB", { waitUntil: "networkidle2", timeout: 60000 });
    const pageDiag = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyLen: (document.body?.innerText || "").length,
      bodyHead: (document.body?.innerText || "").slice(0, 300),
      iframes: Array.from(document.querySelectorAll("iframe")).map((f) => (f as HTMLIFrameElement).src).slice(0, 5),
    }));
    log({ step: "visor_loaded", ok: true, note: JSON.stringify(pageDiag).slice(0, 500) });

    // 2. Aceptar aviso modal (puede tardar en aparecer)
    await sleep(1500);
    let accepted = false;
    for (let i = 0; i < 6 && !accepted; i++) {
      accepted = await clickByText(page, "aceptar");
      if (!accepted) accepted = await clickByText(page, "acepto");
      if (!accepted) await sleep(700);
    }
    log({ step: "modal_aceptar", ok: accepted });

    // 3. Buscar dirección. La caja de búsqueda habitual del Visor IDEAM es un input con placeholder/aria que contiene "buscar".
    const variants = normalizeDireccionForVisor(b.direccion);
    let searched = false; let usedQuery = "";
    // Espera y abre el panel Búsqueda si existe; el input puede ya estar en la barra superior.
    await sleep(3000);
    for (let attempt = 0; attempt < 4 && !searched; attempt++) {
      // intenta abrir panel búsqueda (idempotente)
      await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("[title]"));
        for (const el of els) {
          const t = (el.getAttribute("title") || "").toLowerCase();
          if (t.includes("búsqueda") || t.includes("busqueda")) { (el as HTMLElement).click(); return; }
        }
      });
      await sleep(1500);
      // diagnóstico: lista de frames + inputs por frame
      const frames = page.frames();
      const diag: any[] = [];
      for (const fr of frames) {
        try {
          const inputs = await fr.evaluate(() => {
            const arr = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
            return arr.map((i) => ({ id: i.id, cls: (i.className || "").slice(0, 40), ph: i.placeholder, type: i.type })).slice(0, 8);
          });
          diag.push({ url: fr.url().slice(0, 80), n: inputs.length, inputs });
        } catch (_) { diag.push({ url: fr.url().slice(0, 80), n: -1 }); }
      }
      for (const q of variants) {
        const typed = await page.evaluate((qq: string) => {
          const candidates = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
          const target = candidates.find((i) => i.id === "esri_dijit_Search_0_input")
            || candidates.find((i) => (i.className || "").toLowerCase().includes("searchinput"))
            || candidates.find((i) => ((i.placeholder || "").toLowerCase()).includes("buscar"))
            || candidates.find((i) => i.type === "text" && i.getBoundingClientRect().width > 80);
          if (!target) return false;
          target.focus();
          target.value = qq;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: qq.slice(-1) }));
          return true;
        }, q);
        if (!typed) continue;
        await sleep(3000);
        const picked = await page.evaluate(() => {
          const li = document.querySelector(".searchMenu li, .suggestionsMenu li, .esriSuggestList li, .searchMenu .menuItem, [class*=suggest] li") as HTMLElement | null;
          if (li) { li.click(); return true; }
          return false;
        });
        if (picked) { searched = true; usedQuery = q; break; }
        // Si no hay suggestions, prueba Enter
        try { await page.keyboard.press("Enter"); } catch (_) {}
        await sleep(2500);
        // si el mapa hizo zoom hay un pin → consideramos searched=true heurísticamente
        // (no podemos detectarlo facilmente; seguimos al siguiente variant si no)
      }
      if (!searched) {
        log({ step: `buscar_attempt_${attempt}`, ok: false, note: JSON.stringify(diag).slice(0, 500) });
        await sleep(2000);
      }
    }
    log({ step: "buscar_direccion", ok: searched, note: usedQuery });
    if (!searched) return { ok: false, ...result, motivo: "no_se_pudo_buscar_direccion", steps };
    await sleep(5000);

    // El Visor abre a veces un popup "Resultado" tras el autocompletado. Ciérralo.
    await recorder.closeExtraPages();
    // Cualquier botón "cerrar" del modal Resultado que quede en la página
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll<HTMLElement>('[title="Cerrar"],.dijitDialogCloseIcon,.jimu-icon-close'));
      for (const b of btns) { const r = b.getBoundingClientRect(); if (r.width > 0) b.click(); }
    });
    await sleep(800);

    // 4. Activar herramienta "Identificación de Entidades" y click parcela en el centro del mapa
    const infoActivado = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[title]'));
      const info = els.find((e) => {
        const t = (e.getAttribute('title') || '').toLowerCase();
        return t.includes('identificación de entidades') || t.includes('identificacion de entidades');
      });
      if (info) { (info as HTMLElement).click(); return true; }
      return false;
    });
    log({ step: "info_tool", ok: infoActivado });
    await sleep(1500);

    // El pin de la búsqueda queda centrado; click justo al centro del mapa.
    const vp = page.viewport();
    await page.mouse.click(Math.floor(vp.width / 2), Math.floor(vp.height / 2));
    await sleep(4000);

    // 5. Click "Ordenación: N" (intercepción por red — abre popup nativo)
    recorder.reset();
    let ordenacionClick = await clickOrdenacionLink(page);
    if (!ordenacionClick) {
      // fallback por texto
      ordenacionClick = await clickByText(page, "ordenación") || await clickByText(page, "ordenacion");
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
    log({ step: "vlm_ok", ok: true, note: `n=${result.n_escaleras_visor} conf=${result.confianza}` });

    // 11. Persistir en building_analysis (upsert por building_id)
    const patch: any = {
      building_id,
      n_escaleras_visor: result.n_escaleras_visor,
      escaleras_visor_confianza: result.confianza,
      escaleras_visor_catalogo: result.catalogo,
      escaleras_visor_grado: result.grado,
      escaleras_visor_source: "pg97_analisis_edificacion",
      escaleras_visor_at: new Date().toISOString(),
      escaleras_visor_raw: {
        razonamiento: result.razonamiento,
        patios_vistos: result.patios_vistos,
        manzana: result.manzana,
        catalogo: result.catalogo,
        grado: result.grado,
        doc_url: result.doc_url,
        modelo_usado: result.modelo_usado,
        modelo_fallback: vlm.modelo_fallback,
        prompt_v: 1,
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