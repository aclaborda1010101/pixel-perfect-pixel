// escaleras-visor-madrid — pipeline DETERMINISTA por HTTP (sin navegador, sin agente de visión).
//
// Flujo por edificio:
//   1) Coordenadas EPSG:25830 (X,Y).
//      - Si parcel_geometry_cache.centroid existe: WGS84 → 25830 con proj4.
//      - Si no: Catastro OVCCoordenadas Consulta_CPMRC por RC con SRS=EPSG:25830.
//   2) GET https://servpub.madrid.es/VSURB_WBVISOR/pg97/infoPg97.iam?x=X&y=Y&tab=3
//      Parsea Nº de Catálogo, Nº de Manzana, Grado de Protección, presencia de getDocumento('ANEDIF',...).
//      Si no hay ANEDIF → no protegido por esta vía → guarda motivo y FIN.
//   3) GET https://servpub.madrid.es/VSURB_RSURBA/api_rsurba/v1/descargas/getDocumento?tipoDoc=ANEDIF&docId={Manzana}&docId2=
//   4) Render PDF a PNG (mupdf) → 1 llamada VLM Pro (Gemini 3.1 Pro / fallback 2.5 Pro).
//   5) Upsert en building_analysis y recompute_cluster_score.

import { corsHeaders, err, getServiceClient, json, sleep } from "../_shared/scoring_v2_common.ts";
import proj4 from "npm:proj4@2.11.0";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// EPSG:25830 (ETRS89 / UTM zone 30N)
proj4.defs("EPSG:25830", "+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs");

// deno-lint-ignore no-explicit-any
let _mupdf: any = null;
async function getMupdf() {
  if (_mupdf) return _mupdf;
  _mupdf = await import("npm:mupdf@1.3.0");
  return _mupdf;
}

async function rasterizePdf(buf: Uint8Array, maxPages = 1, scale = 3): Promise<Uint8Array[]> {
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

// Renderiza la primera página completa y devuelve PNG + bounds base (escala 1)
async function renderFullPage(buf: Uint8Array, scale: number): Promise<{ png: Uint8Array; W: number; H: number }> {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const page = doc.loadPage(0);
  const b = page.getBounds();
  const W = b[2] - b[0], H = b[3] - b[1];
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pix.asPNG();
  pix.destroy(); page.destroy(); doc.destroy();
  return { png, W, H };
}

// Renderiza SOLO una región (en coords normalizadas 0..1 sobre la página) a PNG, a la escala dada.
async function renderRegion(buf: Uint8Array, nx0: number, ny0: number, nx1: number, ny1: number, scale: number): Promise<Uint8Array> {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const page = doc.loadPage(0);
  const b = page.getBounds();
  const W = b[2] - b[0], H = b[3] - b[1];
  const rx0 = b[0] + nx0 * W, ry0 = b[1] + ny0 * H, rx1 = b[0] + nx1 * W, ry1 = b[1] + ny1 * H;
  const S = scale;
  const pixBbox = [Math.floor(rx0 * S), Math.floor(ry0 * S), Math.ceil(rx1 * S), Math.ceil(ry1 * S)];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, pixBbox, false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice([1, 0, 0, 1, 0, 0], pix);
  page.run(dev, [S, 0, 0, S, 0, 0]);
  dev.close();
  const png = pix.asPNG();
  pix.destroy(); page.destroy(); doc.destroy();
  return png;
}

// ---------- Coordenadas ----------

type XY = { x: number; y: number; source: string };

async function coordsFromCatastroCPMRC(rc14: string): Promise<XY | null> {
  const url = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC?Provincia=&Municipio=&SRS=EPSG:25830&RC=${encodeURIComponent(rc14)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "*/*" } });
    if (!r.ok) return null;
    const xml = await r.text();
    const xm = xml.match(/<xcen>\s*([\-0-9.]+)\s*<\/xcen>/i);
    const ym = xml.match(/<ycen>\s*([\-0-9.]+)\s*<\/ycen>/i);
    if (!xm || !ym) return null;
    return { x: parseFloat(xm[1]), y: parseFloat(ym[1]), source: "catastro_cpmrc" };
  } catch { return null; }
}

function coordsFromCentroid(centroid: any): XY | null {
  // centroid puede ser { lat, lon } o GeoJSON-ish [lon, lat]
  let lat: number | null = null, lon: number | null = null;
  if (centroid && typeof centroid === "object") {
    if (typeof centroid.lat === "number" && typeof centroid.lon === "number") { lat = centroid.lat; lon = centroid.lon; }
    else if (typeof centroid.lat === "number" && typeof centroid.lng === "number") { lat = centroid.lat; lon = centroid.lng; }
    else if (Array.isArray(centroid.coordinates) && centroid.coordinates.length === 2) {
      lon = centroid.coordinates[0]; lat = centroid.coordinates[1];
    } else if (Array.isArray(centroid) && centroid.length === 2) {
      lon = centroid[0]; lat = centroid[1];
    }
  }
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [x, y] = proj4("EPSG:4326", "EPSG:25830", [lon, lat]);
  return { x, y, source: "centroid_proj4" };
}

// ---------- PG97 HTML parse ----------

type Pg97Meta = { catalogo: string | null; manzana: string | null; grado: string | null; tieneAnedif: boolean; direccionPg97: string | null };

function parsePg97Html(html: string): Pg97Meta {
  // Quitar tags para regex de "tras label". Usamos varias estrategias por robustez.
  const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const text = stripTags(html);

  const grab = (label: RegExp): string | null => {
    const m = text.match(label);
    return m ? m[1].trim() : null;
  };

  const catalogo = grab(/N[ºoO\.]?\s*de\s*Cat[áa]logo[:\s]+([0-9A-Za-z\-\/]+)/i);
  const manzana = grab(/N[ºoO\.]?\s*de\s*Manzana[:\s]+([0-9A-Za-z\-\/]+)/i);
  const grado = grab(/Grado\s*de\s*Protecci[óo]n[:\s]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s\-]+?)(?:\s{2,}|N[ºo]\s|$|Plano|Cat[áa]logo)/i);

  // ANEDIF presence: getDocumento('ANEDIF',...
  const tieneAnedif = /getDocumento\(\s*['"]ANEDIF['"]/i.test(html);

  // Dirección sanity (opcional)
  const dirM = text.match(/Direcci[óo]n[:\s]+([^\n]{3,80})/i);
  const direccionPg97 = dirM ? dirM[1].trim().slice(0, 120) : null;

  return { catalogo, manzana, grado, tieneAnedif, direccionPg97 };
}

// ---------- VLM ----------

const VLM_PROMPT_LOCATE = (catalogo: string | null) => `En este plano de manzana del Catálogo PG97, BUSCA el número impreso ${catalogo ?? "(desconocido)"} (rótulo de parcela). Devuelve JSON: {encontrado:bool, centro:[cx,cy], bbox_parcela:[x0,y0,x1,y1], confianza:0..1} con coordenadas NORMALIZADAS 0..1 (origen arriba-izquierda). bbox_parcela = el polígono de la parcela rotulada con ESE número (sus límites con las parcelas vecinas, líneas finas). Si no encuentras el número, encontrado:false.`;

const VLM_PROMPT_COUNT = (catalogo: string | null) => `Te paso VARIAS imágenes del croquis PG97 de UNA parcela: la 1ª es el recorte COMPLETO de la parcela (úsala para ver sus LÍMITES y confirmar el número de catálogo); las siguientes son CUADRANTES ampliados a alta resolución de esa MISMA parcela (úsalas para ver detalles pequeños que en el recorte completo se pierden).

TAREA:
(1) CONFIRMA que ves impreso el número de catálogo ${catalogo ?? "(desconocido)"} dentro o junto a la parcela.
(2) Cuenta las CAJAS DE ESCALERA que están DENTRO de los límites de la parcela ${catalogo ?? ""}. Ignora trozos de parcelas vecinas en los bordes (separados por líneas finas). No cuentes dos veces una caja que aparezca en el solape de dos cuadrantes.

DEFINICIONES:
- Caja de escalera = recuadro con PELDAÑOS (líneas paralelas finas), a veces en dos tramos alrededor de una meseta, a veces envolviendo el hueco del ascensor (cuadradito pequeño).
- Patio de luces = recuadro con una X (aspa diagonal). NO es escalera, NO cuenta.
- Dos tramos con meseta de UNA MISMA caja = 1 escalera. Dos grupos de peldaños SEPARADOS = 2 escaleras.

MUY IMPORTANTE — el error dominante es CONTAR DE MENOS:
- Los edificios del ensanche/centro de Madrid suelen tener DOS escaleras: la PRINCIPAL (grande, cerca de fachada, normalmente con ascensor) y una ESCALERA DE SERVICIO (más pequeña, hacia el interior/patio, peldaños más estrechos, a menudo SIN ascensor y pegada a un patio). BUSCA activamente esa segunda caja pequeña en los cuadrantes ampliados.
- Un único bloque grande de "elementos comunes" (p. ej. rotulado COM.V) puede contener DOS núcleos de peldaños distintos: cuenta CADA grupo de peldaños separado, no el bloque como uno solo.

JSON: {catalogo_confirmado:bool, n_escaleras:int, patios:int, confianza:0..1, razonamiento:'ubica cada caja de peldaños (principal y de servicio), di por qué es escalera y no patio, y menciona explícitamente si viste o no una 2ª caja pequeña de servicio'}`;

// Extrae el primer objeto JSON balanceado de un texto (acepta texto alrededor / markdown)
function extractFirstJsonObject(txt: string): any | null {
  if (!txt) return null;
  const t = String(txt);
  // intenta directo
  try { return JSON.parse(t); } catch (_e) { /* sigue */ }
  // bloque {...} balanceado
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) {
      const slice = t.slice(start, i + 1);
      try { return JSON.parse(slice); } catch (_e) { return null; }
    } }
  }
  return null;
}

async function callVLM(imageUrls: string[], prompt: string): Promise<{ parsed: any; raw: string; modelo_usado: string; modelo_fallback: boolean; lastErr: string | null }> {
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
  const primary = "google/gemini-3.1-pro-preview";
  const fallback = "google/gemini-2.5-pro";
  let lastErr: string | null = null;
  let lastRaw = "";
  for (const [model, isFallback] of [[primary, false], [fallback, true]] as const) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(model)),
        });
        if (r.status === 429 || r.status === 402) { lastErr = `gateway ${r.status} (${model})`; await sleep(2000 * (attempt + 1)); continue; }
        const j = await r.json();
        const txt = j?.choices?.[0]?.message?.content ?? "";
        lastRaw = String(txt);
        const parsed = extractFirstJsonObject(lastRaw);
        if (parsed) return { parsed, raw: lastRaw, modelo_usado: model, modelo_fallback: !!isFallback, lastErr: null };
        lastErr = `JSON inválido (${model}): ${lastRaw.slice(0, 200)}`;
      } catch (e) { lastErr = `${model}: ${String((e as Error).message ?? e)}`; await sleep(1500); }
    }
  }
  return { parsed: null, raw: lastRaw, modelo_usado: primary, modelo_fallback: false, lastErr };
}

// ---------- procesa un edificio ----------

type StepLog = { step: string; ok: boolean; note?: string; detail?: any };

async function processBuilding(building_id: string, opts?: { force?: boolean }) {
  const sb = getServiceClient();
  const steps: StepLog[] = [];
  const log = (s: StepLog) => { steps.push(s); console.log("[visor]", building_id, s.step, s.ok ? "OK" : "FAIL", s.note ?? ""); };

  const result: any = {
    building_id,
    n_escaleras_visor: null as number | null,
    confianza: null as number | null,
    catalogo: null as string | null,
    manzana: null as string | null,
    grado: null as string | null,
    es_esquina_visor: null as boolean | null,
    calles_frente_visor: null as string[] | null,
    esquina_visor_confianza: null as number | null,
    razonamiento: null as string | null,
    patios_vistos: null as number | null,
    doc_url: null as string | null,
    modelo_usado: null as string | null,
  };

  // 0. Carga edificio
  const { data: b, error: be } = await sb
    .from("buildings")
    .select("id, refcatastral, direccion")
    .eq("id", building_id)
    .maybeSingle();
  if (be || !b) { log({ step: "load_building", ok: false, note: be?.message ?? "no encontrado" }); return { ok: false, ...result, motivo: "edificio_no_encontrado", steps }; }
  log({ step: "load_building", ok: true, note: `${b.direccion} · ${b.refcatastral}` });

  if (!opts?.force) {
    const { data: existing } = await sb.from("building_analysis").select("n_escaleras_visor").eq("building_id", building_id).maybeSingle();
    if (existing && existing.n_escaleras_visor != null) {
      log({ step: "skip_already_done", ok: true, note: `n=${existing.n_escaleras_visor}` });
      return { ok: true, ...result, motivo: "ya_existente", steps };
    }
  }

  const rcRaw = (b.refcatastral || "").trim();
  const rc14 = rcRaw.length >= 14 ? rcRaw.slice(0, 14) : rcRaw;
  if (!rc14 || rc14.length !== 14) {
    return { ok: false, ...result, motivo: `rc_invalida: '${rcRaw}'`, steps: (log({ step: "rc_check", ok: false, note: rcRaw }), steps) };
  }

  // 1. Coordenadas
  let xy: XY | null = null;
  try {
    const { data: pg } = await sb
      .from("parcel_geometry_cache")
      .select("centroid")
      .eq("refcatastral_14", rc14)
      .maybeSingle();
    if (pg?.centroid) xy = coordsFromCentroid(pg.centroid);
    if (xy) log({ step: "coords", ok: true, note: `centroid → x=${xy.x.toFixed(2)} y=${xy.y.toFixed(2)}` });
  } catch (e) { /* sigue al fallback */ }
  if (!xy) {
    xy = await coordsFromCatastroCPMRC(rc14);
    if (xy) log({ step: "coords", ok: true, note: `cpmrc → x=${xy.x.toFixed(2)} y=${xy.y.toFixed(2)}` });
  }
  if (!xy) { log({ step: "coords", ok: false, note: "ni centroid ni CPMRC" }); return { ok: false, ...result, motivo: "no_se_obtuvieron_coordenadas", steps }; }

  // 2. infoPg97.iam
  const pg97Url = `https://servpub.madrid.es/VSURB_WBVISOR/pg97/infoPg97.iam?x=${encodeURIComponent(xy.x.toFixed(2))}&y=${encodeURIComponent(xy.y.toFixed(2))}&tab=3`;
  let pg97Html = "";
  try {
    const r = await fetch(pg97Url, { headers: { "User-Agent": UA, "Accept": "text/html,*/*" } });
    if (!r.ok) { log({ step: "fetch_pg97", ok: false, note: `HTTP ${r.status}` }); return { ok: false, ...result, motivo: `pg97_http_${r.status}`, steps }; }
    pg97Html = await r.text();
  } catch (e: any) {
    log({ step: "fetch_pg97", ok: false, note: String(e?.message ?? e) }); return { ok: false, ...result, motivo: "pg97_fetch_error", steps };
  }
  log({ step: "fetch_pg97", ok: true, note: `${pg97Html.length}b` });

  const meta = parsePg97Html(pg97Html);
  result.catalogo = meta.catalogo; result.manzana = meta.manzana; result.grado = meta.grado;
  log({ step: "parse_pg97", ok: !!(meta.catalogo || meta.manzana), detail: meta });

  if (!meta.tieneAnedif || !meta.manzana) {
    return { ok: true, ...result, motivo: "sin catalogo pg97 / no protegido por esta via", steps };
  }

  // 3. Descargar PDF "Análisis de la Edificación"
  const pdfUrl = `https://servpub.madrid.es/VSURB_RSURBA/api_rsurba/v1/descargas/getDocumento?tipoDoc=ANEDIF&docId=${encodeURIComponent(meta.manzana)}&docId2=`;
  result.doc_url = pdfUrl;
  let pdfBuf: Uint8Array | null = null;
  try {
    const r = await fetch(pdfUrl, { headers: { "User-Agent": UA, "Accept": "application/pdf,*/*", "Referer": pg97Url } });
    if (!r.ok) { log({ step: "fetch_pdf", ok: false, note: `HTTP ${r.status}` }); return { ok: false, ...result, motivo: `pdf_http_${r.status}`, steps }; }
    pdfBuf = new Uint8Array(await r.arrayBuffer());
  } catch (e: any) {
    log({ step: "fetch_pdf", ok: false, note: String(e?.message ?? e) }); return { ok: false, ...result, motivo: "pdf_fetch_error", steps };
  }
  if (!pdfBuf || pdfBuf.length < 1000 || !(pdfBuf[0] === 0x25 && pdfBuf[1] === 0x50)) {
    log({ step: "fetch_pdf", ok: false, note: `bytes=${pdfBuf?.length ?? 0}` });
    return { ok: false, ...result, motivo: "pdf_invalido", steps };
  }
  log({ step: "fetch_pdf", ok: true, note: `${pdfBuf.length}b` });

  // 4. Render página completa (escala 2.5) para PASA 1
  let fullPng: Uint8Array, pageW = 0, pageH = 0;
  try {
    const fp = await renderFullPage(pdfBuf, 2.5);
    fullPng = fp.png; pageW = fp.W; pageH = fp.H;
  } catch (e: any) {
    log({ step: "rasterize_full", ok: false, note: String(e?.message ?? e) }); return { ok: false, ...result, motivo: "raster_error", steps };
  }
  log({ step: "rasterize_full", ok: true, note: `W=${pageW.toFixed(0)} H=${pageH.toFixed(0)} bytes=${fullPng.length}` });

  const ts = Date.now();
  const fullPath = `visor-pg97/${building_id}_full_${ts}.png`;
  const upFull = await sb.storage.from("catastro").upload(fullPath, fullPng, { contentType: "image/png", upsert: true });
  if (upFull.error) { log({ step: "upload_full", ok: false, note: upFull.error.message }); return { ok: false, ...result, motivo: "upload_full_error", steps }; }
  const fullUrl = sb.storage.from("catastro").getPublicUrl(fullPath).data.publicUrl;
  log({ step: "upload_full", ok: true });

  // 5. VLM PASA 1: LOCALIZAR la parcela por su nº de catálogo
  const vlm1 = await callVLM([fullUrl], VLM_PROMPT_LOCATE(meta.catalogo));
  // Guarda SIEMPRE la respuesta cruda en steps[] para diagnóstico
  log({ step: "vlm_locate_raw", ok: !!vlm1.parsed, note: vlm1.lastErr ?? "", detail: { raw: vlm1.raw?.slice(0, 4000) ?? "", modelo: vlm1.modelo_usado } });
  if (!vlm1.parsed) {
    log({ step: "vlm_locate", ok: false, note: vlm1.lastErr ?? "" });
    return { ok: false, ...result, motivo: "vlm_locate_sin_resultado", vlm_error: vlm1.lastErr, needs_review: true, steps };
  }
  const encontrado = vlm1.parsed.encontrado === true;
  const confLoc = Number.parseFloat(String(vlm1.parsed.confianza ?? 0));
  const bboxRaw = Array.isArray(vlm1.parsed.bbox_parcela) ? vlm1.parsed.bbox_parcela.map((v: any) => Number(v)) : null;
  const centro = Array.isArray(vlm1.parsed.centro) ? vlm1.parsed.centro.map((v: any) => Number(v)) : null;

  let bboxValid = false;
  let nx0 = 0, ny0 = 0, nx1 = 1, ny1 = 1;
  if (bboxRaw && bboxRaw.length === 4 && bboxRaw.every((v: number) => Number.isFinite(v))) {
    [nx0, ny0, nx1, ny1] = bboxRaw;
    if (nx1 > nx0 && ny1 > ny0 && nx0 >= 0 && ny0 >= 0 && nx1 <= 1.0001 && ny1 <= 1.0001) bboxValid = true;
  }
  log({ step: "vlm_locate", ok: encontrado && confLoc >= 0.5 && bboxValid, note: `encontrado=${encontrado} conf=${confLoc} bbox=${JSON.stringify(bboxRaw)} centro=${JSON.stringify(centro)}` });

  // REGLA DURA: sin localización fiable NO contamos sobre la manzana entera.
  if (!encontrado || !bboxValid || confLoc < 0.5) {
    const motivo = !encontrado
      ? "no_se_pudo_localizar_parcela"
      : !bboxValid ? "bbox_invalido_pasa1"
      : "confianza_localizacion_baja";
    const patchSkip: any = {
      building_id,
      n_escaleras_visor: null,
      escaleras_visor_confianza: null,
      escaleras_visor_catalogo: meta.catalogo,
      escaleras_visor_grado: meta.grado,
      escaleras_visor_source: "pg97_analisis_edificacion",
      escaleras_visor_at: new Date().toISOString(),
      escaleras_visor_raw: {
        motivo,
        needs_review: true,
        manzana: meta.manzana,
        catalogo: meta.catalogo,
        grado: meta.grado,
        doc_url: result.doc_url,
        coords: { x: xy.x, y: xy.y, source: xy.source },
        prompt_v: 5,
        pasa1: {
          encontrado, confianza: confLoc, bbox_parcela: bboxRaw, centro,
          modelo: vlm1.modelo_usado, raw: vlm1.raw?.slice(0, 4000) ?? "",
        },
        bbox_used: null,
        used_crop: false,
        steps,
      },
    };
    const { data: ex0 } = await sb.from("building_analysis").select("id").eq("building_id", building_id).maybeSingle();
    if (ex0) await sb.from("building_analysis").update(patchSkip).eq("building_id", building_id);
    else await sb.from("building_analysis").insert(patchSkip);
    return { ok: true, ...result, motivo, needs_review: true, steps };
  }

  // 6. Recorte AISLADO en ALTA RESOLUCIÓN + 4 cuadrantes ampliados (tiling 2x2).
  //    Antes: un único recorte a ~1400px de ancho (targetWpx=1400) → a esa
  //    resolución la escalera de servicio (pequeña, al patio) se fundía con la
  //    principal y el VLM contaba 1. Ahora apuntamos a ~3600px en el recorte
  //    completo y añadimos 4 cuadrantes a ~el doble de densidad para ver los
  //    núcleos pequeños. Es el gesto que hace la lectura manual (zoom 8-11).
  const padX = (nx1 - nx0) * 0.08, padY = (ny1 - ny0) * 0.08;
  const cx0 = Math.max(0, nx0 - padX), cy0 = Math.max(0, ny0 - padY);
  const cx1 = Math.min(1, nx1 + padX), cy1 = Math.min(1, ny1 + padY);
  const widthPts = (cx1 - cx0) * pageW;
  const Sfull = Math.max(4, Math.min(12, 3600 / Math.max(1, widthPts)));
  const Stile = Math.max(6, Math.min(16, 3600 / Math.max(1, widthPts * 0.5)));
  const imageUrls: string[] = [];
  let bboxUsed: number[] | null = null;
  try {
    // 6a. Recorte completo (límites de parcela + confirmación de catálogo)
    const fullCrop = await renderRegion(pdfBuf, cx0, cy0, cx1, cy1, Sfull);
    const fullCropPath = `visor-pg97/${building_id}_crop_${ts}.png`;
    const upFC = await sb.storage.from("catastro").upload(fullCropPath, fullCrop, { contentType: "image/png", upsert: true });
    if (upFC.error) { log({ step: "render_crop", ok: false, note: upFC.error.message }); return { ok: false, ...result, motivo: "upload_crop_error", needs_review: true, steps }; }
    imageUrls.push(sb.storage.from("catastro").getPublicUrl(fullCropPath).data.publicUrl);
    // 6b. 4 cuadrantes 2x2 con solape 10% (detalle de núcleos pequeños)
    const mx = (cx0 + cx1) / 2, my = (cy0 + cy1) / 2;
    const ovx = (cx1 - cx0) * 0.10, ovy = (cy1 - cy0) * 0.10;
    const tiles: [number, number, number, number][] = [
      [cx0, cy0, mx + ovx, my + ovy],
      [mx - ovx, cy0, cx1, my + ovy],
      [cx0, my - ovy, mx + ovx, cy1],
      [mx - ovx, my - ovy, cx1, cy1],
    ];
    for (let ti = 0; ti < tiles.length; ti++) {
      const [tx0, ty0, tx1, ty1] = tiles[ti];
      try {
        const tilePng = await renderRegion(pdfBuf, Math.max(0, tx0), Math.max(0, ty0), Math.min(1, tx1), Math.min(1, ty1), Stile);
        const tilePath = `visor-pg97/${building_id}_tile${ti}_${ts}.png`;
        const upT = await sb.storage.from("catastro").upload(tilePath, tilePng, { contentType: "image/png", upsert: true });
        if (!upT.error) imageUrls.push(sb.storage.from("catastro").getPublicUrl(tilePath).data.publicUrl);
      } catch (_e) { /* un tile que falle no aborta: seguimos con los demás */ }
    }
    bboxUsed = [cx0, cy0, cx1, cy1];
    log({ step: "render_crop", ok: true, note: `Sfull=${Sfull.toFixed(1)} Stile=${Stile.toFixed(1)} imgs=${imageUrls.length}` });
  } catch (e: any) {
    log({ step: "render_crop", ok: false, note: String(e?.message ?? e) });
    return { ok: false, ...result, motivo: "render_crop_error", needs_review: true, steps };
  }

  // 7. VLM PASA 2: confirmar catálogo + contar (recorte completo + cuadrantes)
  const vlm2 = await callVLM(imageUrls, VLM_PROMPT_COUNT(meta.catalogo));
  if (!vlm2.parsed) {
    log({ step: "vlm_count", ok: false, note: vlm2.lastErr ?? "" });
    return { ok: false, ...result, motivo: "vlm_count_sin_resultado", vlm_error: vlm2.lastErr, needs_review: true, steps };
  }
  result.modelo_usado = vlm2.modelo_usado;
  const catConfirmado = vlm2.parsed.catalogo_confirmado === true;
  const n = Number.parseInt(String(vlm2.parsed.n_escaleras ?? 0), 10);
  let conf = Number.parseFloat(String(vlm2.parsed.confianza ?? 0));
  let needsReview = false;
  if (!catConfirmado) { conf = Math.min(conf, 0.5); needsReview = true; }
  result.n_escaleras_visor = Number.isFinite(n) ? n : null;
  result.confianza = Number.isFinite(conf) ? conf : null;
  result.razonamiento = String(vlm2.parsed.razonamiento ?? "").slice(0, 4000);
  result.patios_vistos = Number.isFinite(Number(vlm2.parsed.patios)) ? Number(vlm2.parsed.patios) : null;
  log({ step: "vlm_count", ok: true, note: `n=${result.n_escaleras_visor} conf=${result.confianza} catConfirmado=${catConfirmado}` });

  // 8. Persistir
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
      coords: { x: xy.x, y: xy.y, source: xy.source },
      modelo_usado: result.modelo_usado,
      modelo_fallback: vlm2.modelo_fallback,
      prompt_v: 5,
      n_imgs: imageUrls.length,
      needs_review: needsReview,
      pasa1: {
        encontrado, confianza: confLoc, bbox_parcela: bboxRaw, centro,
        modelo: vlm1.modelo_usado,
        raw: vlm1.raw?.slice(0, 4000) ?? "",
      },
      pasa2: {
        catalogo_confirmado: catConfirmado,
        n_escaleras: result.n_escaleras_visor,
        confianza: result.confianza,
        patios: result.patios_vistos,
        razonamiento: result.razonamiento,
        modelo: vlm2.modelo_usado,
      },
      bbox_used: bboxUsed,
      used_crop: true,
      steps,
    },
  };
  const { data: existing } = await sb.from("building_analysis").select("id").eq("building_id", building_id).maybeSingle();
  if (existing) await sb.from("building_analysis").update(patch).eq("building_id", building_id);
  else await sb.from("building_analysis").insert(patch);

  try { await sb.rpc("compute_cluster_score", { p_building_id: building_id }); } catch (e) { console.warn("recompute fail", e); }

  return { ok: true, ...result, steps };
}

async function persistSinCatalogo(sb: any, building_id: string, motivo: string, meta: { catalogo: string | null; manzana: string | null; grado: string | null } | null, steps: StepLog[]) {
  const patch: any = {
    building_id,
    n_escaleras_visor: null,
    escaleras_visor_confianza: null,
    escaleras_visor_catalogo: meta?.catalogo ?? null,
    escaleras_visor_grado: meta?.grado ?? null,
    escaleras_visor_at: new Date().toISOString(),
    escaleras_visor_source: "pg97_analisis_edificacion",
    escaleras_visor_raw: { motivo, manzana: meta?.manzana ?? null, steps },
  };
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

  const out: any[] = [];
  for (const id of ids) {
    try {
      const r = await processBuilding(id, { force: !!body.force });
      if (r.ok && (r as any).motivo === "sin catalogo pg97 / no protegido por esta via") {
        try { await persistSinCatalogo(sb, id, (r as any).motivo, { catalogo: (r as any).catalogo, manzana: (r as any).manzana, grado: (r as any).grado }, (r as any).steps ?? []); } catch (_e) { /* ignore */ }
      }
      out.push(r);
    } catch (e: any) {
      out.push({ ok: false, building_id: id, error: String(e?.message ?? e) });
    }
  }

  return json({ ok: true, processed: out.length, results: out });
});
