import { corsHeaders, err, getServiceClient, json, setProcessingStatus, sleep } from "../_shared/scoring_v2_common.ts";
// MuPDF WASM — renders PDF pages to PNG inside Deno
// deno-lint-ignore no-explicit-any
let _mupdf: any = null;
async function getMupdf() {
  if (_mupdf) return _mupdf;
  _mupdf = await import("npm:mupdf@1.3.0");
  return _mupdf;
}

const NOMINATIM_UA = "AffluxProperty/1.0 (acifuentes@abius.es)";
const SEDE = "https://www1.sedecatastro.gob.es";
const PLANTAS_PDF_CANDIDATES = (refcat: string) => [
  `${SEDE}/Cartografia/GeneraDocPlantas.aspx?refcat=${refcat}&del=&mun=`,
  `${SEDE}/Cartografia/GeneraGraficoPlantas.aspx?refcat=${refcat}&del=&mun=`,
  `${SEDE}/Cartografia/GeneraDocPlantasParcela.aspx?refcat=${refcat}`,
];
const PLANTAS_HTML_PAGE = (refcat: string) =>
  `${SEDE}/Cartografia/mapa.aspx?refcat=${refcat}&del=&mun=&final=`;
const UA = "Mozilla/5.0 (AffluxProperty/1.0; +mailto:acifuentes@abius.es)";

async function tryFetchPdf(url: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/pdf,*/*" } });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const ct = r.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await r.arrayBuffer());
    // PDF magic %PDF
    if (buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return buf;
    if (ct.toLowerCase().includes("pdf") && buf.length > 100) return buf;
    return null;
  } catch (_e) { return null; }
}

async function discoverPlantasPdfUrl(refcat: string): Promise<string | null> {
  try {
    const r = await fetch(PLANTAS_HTML_PAGE(refcat), { headers: { "User-Agent": UA } });
    const html = await r.text();
    // Look for hrefs that mention "plantas" or "distribuc"
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const h of hrefs) {
      if (/plantas|distribuc/i.test(h) && /\.pdf|GeneraDoc|GeneraGrafico/i.test(h)) {
        return h.startsWith("http") ? h : `${SEDE}${h.startsWith("/") ? h : "/" + h}`;
      }
    }
  } catch (_e) { /* ignore */ }
  return null;
}

async function rasterizePdfToPng(buf: Uint8Array, maxPages = 12, scale = 2): Promise<Uint8Array[]> {
  const mupdf = await getMupdf();
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const n = Math.min(doc.countPages(), maxPages);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true,
    );
    out.push(pixmap.asPNG());
    pixmap.destroy();
    page.destroy();
  }
  doc.destroy();
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { building_id, force } = await req.json();
    if (!building_id) return err("building_id requerido", 400);

    const sb = getServiceClient();
    await setProcessingStatus(building_id, "catastro", "running");

    const { data: b } = await sb
      .from("buildings")
      .select("id, direccion, ciudad, refcatastral, metadatos")
      .eq("id", building_id)
      .maybeSingle();
    if (!b) {
      await setProcessingStatus(building_id, "catastro", "error", "building no encontrado");
      return err("building no encontrado", 404);
    }

    // Si ya tenemos refcatastral y no se pide force, devolver cache
    let refcat: string | null = b.refcatastral
      ?? (b.metadatos as any)?.referencia_catastral
      ?? null;

    // 1. Si no hay refcatastral: geocodificar + RCCOOR
    if (!refcat || force) {
      const direccion = b.direccion;
      if (!direccion) {
        await setProcessingStatus(building_id, "catastro", "error", "sin dirección");
        return err("building sin dirección para geocodificar", 400);
      }
      const q = encodeURIComponent(`${direccion}, ${b.ciudad ?? "Madrid"}, España`);
      const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
        headers: { "User-Agent": NOMINATIM_UA },
      });
      const nom = await nomRes.json();
      await sleep(1100);
      const lat = Number(nom?.[0]?.lat);
      const lon = Number(nom?.[0]?.lon);
      if (!isFinite(lat) || !isFinite(lon)) {
        await setProcessingStatus(building_id, "catastro", "error", "geocoding falló");
        return err("Nominatim no devolvió coordenadas", 422);
      }

      // Catastro RCCOOR (JSON)
      try {
        const rRes = await fetch(
          `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR?Coordenada_X=${lon}&Coordenada_Y=${lat}&SRS=EPSG:4326`,
        );
        const rXml = await rRes.text();
        const pc1 = /<pc1>([^<]+)<\/pc1>/i.exec(rXml)?.[1] ?? "";
        const pc2 = /<pc2>([^<]+)<\/pc2>/i.exec(rXml)?.[1] ?? "";
        refcat = (pc1 + pc2).trim() || null;
      } catch (e) {
        console.warn("RCCOOR fail", e);
      }

      await sb.from("catastro_data").upsert({
        refcatastral: refcat ?? `unknown-${building_id}`,
        building_id,
        lat, lon,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "refcatastral" });

      if (refcat) {
        await sb.from("buildings").update({ refcatastral: refcat }).eq("id", building_id);
      } else {
        await setProcessingStatus(building_id, "catastro", "error", "no se obtuvo refcatastral");
        return json({ status: "no_refcatastral", lat, lon });
      }
    }

    // 2a. Descargar SVG croquis (fallback / referencia rápida)
    const svgPath = `${refcat}.svg`;
    let plano_url: string | null = null;
    try {
      const planoRes = await fetch(
        `${SEDE}/Cartografia/GeneraGraficoParcela.aspx?refcat=${refcat}&del=&mun=`,
        { headers: { "User-Agent": UA } },
      );
      const planoTxt = await planoRes.text();
      const svgMatch = /<svg[\s\S]*?<\/svg>/i.exec(planoTxt);
      if (svgMatch) {
        const bytes = new TextEncoder().encode(svgMatch[0]);
        await sb.storage.from("catastro").upload(svgPath, bytes, {
          contentType: "image/svg+xml",
          upsert: true,
        });
      }
    } catch (e) {
      console.warn("plano svg fetch fail", e);
    }
    plano_url = sb.storage.from("catastro").getPublicUrl(svgPath).data.publicUrl;

    // 2b. Descargar PDF "Documento de distribución por plantas" + rasterizar páginas
    let plantas_pdf_url: string | null = null;
    let plantas_pages_urls: string[] = [];
    let plantas_num_pages = 0;
    let plantas_pdf_disponible = false;

    let pdfBuf: Uint8Array | null = null;
    for (const candidate of PLANTAS_PDF_CANDIDATES(refcat)) {
      pdfBuf = await tryFetchPdf(candidate);
      if (pdfBuf) break;
    }
    if (!pdfBuf) {
      const discovered = await discoverPlantasPdfUrl(refcat);
      if (discovered) pdfBuf = await tryFetchPdf(discovered);
    }

    if (pdfBuf) {
      try {
        const pdfPath = `${refcat}_plantas.pdf`;
        await sb.storage.from("catastro").upload(pdfPath, pdfBuf, {
          contentType: "application/pdf",
          upsert: true,
        });
        plantas_pdf_url = sb.storage.from("catastro").getPublicUrl(pdfPath).data.publicUrl;

        try {
          const pages = await rasterizePdfToPng(pdfBuf, 12, 2);
          plantas_num_pages = pages.length;
          const urls: string[] = [];
          for (let i = 0; i < pages.length; i++) {
            const pPath = `${refcat}_p${i + 1}.png`;
            await sb.storage.from("catastro").upload(pPath, pages[i], {
              contentType: "image/png",
              upsert: true,
            });
            urls.push(sb.storage.from("catastro").getPublicUrl(pPath).data.publicUrl);
          }
          plantas_pages_urls = urls;
          plantas_pdf_disponible = true;
        } catch (rasterErr) {
          console.warn("rasterización PDF falló", rasterErr);
          plantas_pdf_disponible = true; // tenemos PDF aunque no PNGs
        }
      } catch (uErr) {
        console.warn("upload plantas PDF fail", uErr);
      }
    } else {
      console.warn("plantas PDF no disponible, usando solo SVG croquis");
    }

    // 3. DNPRC datos alfanuméricos
    let dnprc_json: unknown = null;
    try {
      const dRes = await fetch(
        `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${refcat}`,
      );
      const dTxt = await dRes.text();
      dnprc_json = parseDnprcXml(dTxt);
    } catch (e) {
      console.warn("DNPRC fail", e);
    }

    await sb.from("catastro_data").update({
      plano_url,
      dnprc_json,
      plantas_pdf_url,
      plantas_pages_urls,
      plantas_num_pages: plantas_num_pages || null,
      plantas_pdf_disponible,
      fetch_quality: plantas_pdf_disponible ? 'high' : 'low',
      fetched_at: new Date().toISOString(),
      fetch_error: null,
    }).eq("refcatastral", refcat);

    await setProcessingStatus(building_id, "catastro", "ok");
    return json({
      status: "ok",
      refcatastral: refcat,
      plano_url,
      plantas_pdf_url,
      plantas_num_pages,
      plantas_pdf_disponible,
    });
  } catch (e) {
    console.error("fetch-catastro-data error", e);
    return err(String((e as Error).message ?? e));
  }
});

// --- DNPRC XML parser ---
function pick(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, "i").exec(xml);
  return m?.[1]?.trim() || null;
}
function pickNum(xml: string, tag: string): number | null {
  const v = pick(xml, tag);
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
function usoFromCode(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    V: "Vivienda",
    R: "Residencial",
    C: "Comercial",
    O: "Oficinas",
    A: "Almacén",
    P: "Aparcamiento",
    G: "Garaje",
    I: "Industrial",
    K: "Deportivo",
    T: "Espectáculos",
    Y: "Sanidad/Beneficencia",
    E: "Cultural",
    M: "Obras urbanización",
    H: "Hostelería",
    B: "Almacén agrario",
    J: "Industrial agrario",
    Z: "Agrario",
  };
  return map[code.toUpperCase()] ?? code;
}
function parseDnprcXml(xml: string) {
  if (!xml || !xml.trim().startsWith("<")) {
    return { parse_error: "respuesta no XML", xml_preview: xml?.slice(0, 2000) ?? null };
  }
  // dirección oficial (bloque <dt> con <locs>)
  const dirBlock = /<dt[^>]*>[\s\S]*?<\/dt>/i.exec(xml)?.[0] ?? "";
  const tv = pick(dirBlock, "tv");
  const nv = pick(dirBlock, "nv");
  const pnp = pick(dirBlock, "pnp");
  const np = pick(dirBlock, "snp") || pick(dirBlock, "es") || null;
  const cp = pick(dirBlock, "cp");
  const cm = pick(dirBlock, "nm") || pick(dirBlock, "tm");
  const direccion_oficial = [tv, nv, pnp].filter(Boolean).join(" ") +
    (np ? `, ${np}` : "") +
    (cm ? `, ${cm}` : "") +
    (cp ? ` (${cp})` : "");

  // datos del bien inmueble (<debi>)
  const debi = /<debi[^>]*>[\s\S]*?<\/debi>/i.exec(xml)?.[0] ?? "";
  const uso_code = pick(debi, "luso");
  const uso_principal = usoFromCode(uso_code);
  const ano_construccion = pickNum(debi, "ant");
  const superficie_construida = pickNum(debi, "sfc");
  const coef_participacion = pickNum(debi, "cpt");

  // Subparcelas / locales: <lcons> con <lcd> cada uno
  const subparcelas: any[] = [];
  const lconsBlock = /<lcons[^>]*>[\s\S]*?<\/lcons>/i.exec(xml)?.[0] ?? "";
  const lcdMatches = lconsBlock.matchAll(/<lcd[^>]*>[\s\S]*?<\/lcd>/gi);
  for (const m of lcdMatches) {
    const b = m[0];
    subparcelas.push({
      uso: usoFromCode(pick(b, "lcd")) || pick(b, "dt"),
      planta: pick(b, "pt") || pick(b, "lcd"),
      puerta: pick(b, "pu"),
      escalera: pick(b, "es"),
      superficie_m2: pickNum(b, "dfcc") ?? pickNum(b, "sfc"),
    });
  }

  // superficie solar (suelo) en <ssp> o similares
  const superficie_solar = pickNum(xml, "sup") ?? pickNum(xml, "ssp") ?? null;

  // Calcular % terciario (no vivienda)
  let pct_terciario: number | null = null;
  const totalM2 = subparcelas.reduce((s, x) => s + (Number(x.superficie_m2) || 0), 0);
  if (totalM2 > 0) {
    const ter = subparcelas
      .filter((x) => !/vivienda/i.test(x.uso ?? ""))
      .reduce((s, x) => s + (Number(x.superficie_m2) || 0), 0);
    pct_terciario = Number(((ter / totalM2) * 100).toFixed(1));
  }

  // nº plantas distintas según subparcelas
  const plantas_set = new Set(
    subparcelas
      .map((x) => (x.planta ?? "").toString().trim())
      .filter((p) => p && p !== "-"),
  );

  return {
    direccion_oficial: direccion_oficial.replace(/\s+/g, " ").trim() || null,
    uso_principal,
    uso_code,
    ano_construccion,
    superficie_construida,
    superficie_solar,
    coef_participacion,
    num_plantas_catastro: plantas_set.size || null,
    num_subparcelas: subparcelas.length || null,
    pct_terciario,
    subparcelas,
    xml_preview: xml.slice(0, 4000),
  };
}