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

const VLM_PROMPT_LOCATE = (catalogo: string | null, calle: string, numero: string | null) => `Eres un experto en lectura de planos catastrales de Madrid (Catálogo PG97). El croquis "Análisis de la Edificación" muestra una MANZANA con varias parcelas rotuladas por Nº de Catálogo y las CALLES rotuladas alrededor.

TAREA: localiza la parcela rotulada con Nº de Catálogo ${catalogo ?? "(desconocido)"} (calle ${calle}, nº ${numero ?? "?"}).
(a) Devuelve el bounding box [x0,y0,x1,y1] en coordenadas NORMALIZADAS 0..1 (origen arriba-izquierda, x derecha, y abajo) ajustado a los LÍMITES de ESA parcela.
(b) ¿A qué calles rotuladas da esa parcela? Devuelve los nombres tal como aparecen ("Calle de Serrano", etc.). es_esquina=true si limita con >=2 calles rotuladas distintas.

JSON estricto:
{ "bbox": [x0,y0,x1,y1], "calles_frente": [..], "es_esquina": <bool>, "confianza_loc": <0..1>, "confianza_esquina": <0..1>, "razonamiento": "<breve>" }`;

const VLM_PROMPT_COUNT = `Esta imagen es el RECORTE de UNA parcela del croquis PG97 "Análisis de la Edificación". 

Cuenta SUS cajas de escalera:
- CAJA DE ESCALERA = recuadro con PELDAÑOS dibujados (líneas paralelas finas, a veces dos tramos con meseta, a veces envolviendo el hueco del ascensor que es un cuadradito). Dos tramos con meseta de UNA misma caja = 1 escalera, NO 2.
- PATIO de luces = recuadro con una X (aspa). NO es escalera; anótalo en patios.
- Cuenta SOLO lo que esté dentro de los límites de la parcela recortada; ignora trozos de parcelas vecinas en los bordes.

JSON estricto: { "n_escaleras": <int>, "patios": <int>, "confianza": <0..1>, "razonamiento": "<breve, indica dónde está cada caja>" }`;

async function callVLM(imageUrls: string[], prompt: string): Promise<{ parsed: any; modelo_usado: string; modelo_fallback: boolean; lastErr: string | null }> {
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
        try { return { parsed: JSON.parse(txt), modelo_usado: model, modelo_fallback: !!isFallback, lastErr: null }; }
        catch { lastErr = `JSON inválido (${model}): ${txt.slice(0, 120)}`; }
      } catch (e) { lastErr = `${model}: ${String((e as Error).message ?? e)}`; await sleep(1500); }
    }
  }
  return { parsed: null, modelo_usado: primary, modelo_fallback: false, lastErr };
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

  // 5. VLM PASA 1: localizar parcela + calles
  const numero = (b.direccion?.match(/\b(\d{1,4})\b/)?.[1]) ?? null;
  const calleSimple = (b.direccion ?? "").replace(/\b\d{1,4}\b.*$/, "").trim();
  const vlm1 = await callVLM([fullUrl], VLM_PROMPT_LOCATE(meta.catalogo, calleSimple, numero));
  if (!vlm1.parsed) {
    log({ step: "vlm_locate", ok: false, note: vlm1.lastErr ?? "" }); return { ok: false, ...result, motivo: "vlm_locate_sin_resultado", vlm_error: vlm1.lastErr, steps };
  }
  const bbox = Array.isArray(vlm1.parsed.bbox) ? vlm1.parsed.bbox.map((v: any) => Number(v)) : null;
  const confLoc = Number.parseFloat(String(vlm1.parsed.confianza_loc ?? 0));
  const callesArr = Array.isArray(vlm1.parsed.calles_frente) ? (vlm1.parsed.calles_frente as any[]).map((c) => String(c)).slice(0, 6) : [];
  result.calles_frente_visor = callesArr.length ? callesArr : null;
  if (typeof vlm1.parsed.es_esquina === "boolean") result.es_esquina_visor = vlm1.parsed.es_esquina;
  else if (callesArr.length) result.es_esquina_visor = callesArr.length >= 2;
  const cesq = Number.parseFloat(String(vlm1.parsed.confianza_esquina ?? 0));
  result.esquina_visor_confianza = Number.isFinite(cesq) ? cesq : null;
  log({ step: "vlm_locate", ok: true, note: `bbox=${JSON.stringify(bbox)} confLoc=${confLoc} esq=${result.es_esquina_visor} calles=${callesArr.join("|")}` });

  // 6. Decide imagen para PASA 2: recorte si bbox válido y conf>=0.4, si no full + downgrade
  let bboxValid = false;
  let nx0 = 0, ny0 = 0, nx1 = 1, ny1 = 1;
  if (bbox && bbox.length === 4 && bbox.every((v: number) => Number.isFinite(v))) {
    [nx0, ny0, nx1, ny1] = bbox;
    if (nx1 > nx0 && ny1 > ny0 && nx0 >= 0 && ny0 >= 0 && nx1 <= 1.0001 && ny1 <= 1.0001) bboxValid = true;
  }
  let cropUrl = fullUrl;
  let usedCrop = false;
  let bboxUsed: number[] | null = null;
  if (bboxValid && confLoc >= 0.4) {
    // padding 12%
    const padX = (nx1 - nx0) * 0.12, padY = (ny1 - ny0) * 0.12;
    const cx0 = Math.max(0, nx0 - padX), cy0 = Math.max(0, ny0 - padY);
    const cx1 = Math.min(1, nx1 + padX), cy1 = Math.min(1, ny1 + padY);
    const targetWpx = 1400;
    const widthPts = (cx1 - cx0) * pageW;
    const S = Math.max(2, Math.min(10, targetWpx / Math.max(1, widthPts)));
    try {
      const cropPng = await renderRegion(pdfBuf, cx0, cy0, cx1, cy1, S);
      const cropPath = `visor-pg97/${building_id}_crop_${ts}.png`;
      const upCrop = await sb.storage.from("catastro").upload(cropPath, cropPng, { contentType: "image/png", upsert: true });
      if (!upCrop.error) {
        cropUrl = sb.storage.from("catastro").getPublicUrl(cropPath).data.publicUrl;
        usedCrop = true;
        bboxUsed = [cx0, cy0, cx1, cy1];
        log({ step: "render_crop", ok: true, note: `S=${S.toFixed(2)} bytes=${cropPng.length}` });
      } else {
        log({ step: "render_crop", ok: false, note: upCrop.error.message });
      }
    } catch (e: any) {
      log({ step: "render_crop", ok: false, note: String(e?.message ?? e) });
    }
  } else {
    log({ step: "render_crop", ok: false, note: `bbox_invalid_or_low_conf (confLoc=${confLoc})` });
  }

  // 7. VLM PASA 2: contar
  const vlm2 = await callVLM([cropUrl], VLM_PROMPT_COUNT);
  if (!vlm2.parsed) {
    log({ step: "vlm_count", ok: false, note: vlm2.lastErr ?? "" }); return { ok: false, ...result, motivo: "vlm_count_sin_resultado", vlm_error: vlm2.lastErr, steps };
  }
  result.modelo_usado = vlm2.modelo_usado;
  const n = Number.parseInt(String(vlm2.parsed.n_escaleras ?? 0), 10);
  let conf = Number.parseFloat(String(vlm2.parsed.confianza ?? 0));
  if (!usedCrop) conf = Math.min(conf, 0.6); // fallback: capa de confianza
  result.n_escaleras_visor = Number.isFinite(n) ? n : null;
  result.confianza = Number.isFinite(conf) ? conf : null;
  result.razonamiento = String(vlm2.parsed.razonamiento ?? "").slice(0, 4000);
  result.patios_vistos = Number.isFinite(Number(vlm2.parsed.patios)) ? Number(vlm2.parsed.patios) : null;
  log({ step: "vlm_count", ok: true, note: `n=${result.n_escaleras_visor} conf=${result.confianza} crop=${usedCrop}` });

  // 6. Persistir
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
      coords: { x: xy.x, y: xy.y, source: xy.source },
      modelo_usado: result.modelo_usado,
      modelo_fallback: vlm2.modelo_fallback,
      prompt_v: 3,
      es_esquina: result.es_esquina_visor,
      calles_frente: result.calles_frente_visor,
      confianza_esquina: result.esquina_visor_confianza,
      pasa1: { bbox, confianza_loc: confLoc, calles_frente: callesArr, es_esquina: result.es_esquina_visor, razonamiento: String(vlm1.parsed.razonamiento ?? "").slice(0, 1500), modelo: vlm1.modelo_usado },
      pasa2: { n_escaleras: result.n_escaleras_visor, confianza: result.confianza, patios: result.patios_vistos, razonamiento: result.razonamiento, modelo: vlm2.modelo_usado },
      bbox_used: bboxUsed,
      used_crop: usedCrop,
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
