// Edge function: fetch-fxcc-pdf
// Descarga el PDF FXCC (Ficha de Distribución por Plantas) del Catastro
// usando sesión cookies + descubrimiento de enlaces. Si lo obtiene, lo
// almacena en storage `catastro` como `<refcat>_plantas.pdf` y rasteriza
// las páginas a PNG (`<refcat>_plantas_p{n}.png`).
//
// Si no consigue el FXCC real, marca plantas_pdf_disponible=false pero NO
// borra los datos existentes (el usuario puede subirlo manualmente).

import { corsHeaders, err, getServiceClient, json, sleep } from "../_shared/scoring_v2_common.ts";

// deno-lint-ignore no-explicit-any
let _mupdf: any = null;
async function getMupdf() {
  if (_mupdf) return _mupdf;
  _mupdf = await import("npm:mupdf@1.3.0");
  return _mupdf;
}

const SEDE = "https://www1.sedecatastro.gob.es";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// Endpoints candidatos para el FXCC (Ficha plantas) — se prueban en orden con
// la sesión activa. Catastro cambia los nombres con el tiempo así que probamos
// varios. El primero que devuelva un PDF >40KB con magic %PDF se acepta.
const FXCC_CANDIDATES = (refcat: string) => [
  `${SEDE}/Cartografia/GeneradorPlanos.aspx?refcat=${refcat}&tipoPlano=plantas`,
  `${SEDE}/Cartografia/GeneradorPlantasInmueble.aspx?refcat=${refcat}`,
  `${SEDE}/Cartografia/PlanoEdificio.aspx?refcat=${refcat}`,
  `${SEDE}/CYCBienInmueble/OVCFXCC.aspx?RefC=${refcat}`,
  `${SEDE}/CYCBienInmueble/SECImprimirDistribucionPlantas.aspx?refcat=${refcat}`,
  `${SEDE}/CYCBienInmueble/OVCDescargaFXCC.aspx?RefC=${refcat}`,
  `${SEDE}/Cartografia/BuscarParcelaInternet.aspx?refcat=${refcat}&tipo=FXCC`,
];

// Cookies simples (sin parser completo): guardamos las cookies emitidas y las
// adjuntamos en peticiones siguientes.
class CookieJar {
  jar = new Map<string, string>();
  addFromResponse(res: Response) {
    const sc = (res.headers as any).getSetCookie?.() as string[] | undefined;
    const raw = sc ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const line of raw) {
      const m = /^([^=]+)=([^;]+)/.exec(line);
      if (m) this.jar.set(m[1].trim(), m[2].trim());
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function isPdf(buf: Uint8Array): boolean {
  return buf.length > 1000 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

// Heurística: el PDF "genérico" (SECImprimirCroquisYDatos) suele pesar 100-200KB
// y tener 2-3 páginas. El FXCC real con plantas tiene 4+ páginas y >300KB.
// Confiamos en el contenido cuando viene de un endpoint *específicamente* de plantas.
function looksLikePlantasPdf(buf: Uint8Array, urlHint: string): boolean {
  if (!isPdf(buf)) return false;
  if (/plantas|FXCC|distribuc|PlanoEdif|PlantasInmueble/i.test(urlHint)) return true;
  // Si es un endpoint genérico, exigimos >300KB
  return buf.length > 300_000;
}

async function fetchWithSession(url: string, jar: CookieJar, accept = "application/pdf,text/html,*/*"): Promise<Response> {
  return await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": accept,
      "Accept-Language": "es-ES,es;q=0.9",
      "Cookie": jar.header(),
      "Referer": `${SEDE}/CYCBienInmueble/OVCConCiud.aspx`,
    },
    redirect: "follow",
  });
}

async function tryFetchFxccPdf(refcat: string): Promise<{ buf: Uint8Array; url: string } | null> {
  const jar = new CookieJar();

  // 1. Establecer sesión visitando la página de consulta (genera ASP.NET_SessionId)
  try {
    const init = await fetch(`${SEDE}/CYCBienInmueble/OVCConCiud.aspx?UrbRus=U&RefC=${refcat}`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
    });
    jar.addFromResponse(init);
    await init.body?.cancel();
  } catch (e) {
    console.warn("[fxcc] no se pudo establecer sesión", e);
  }

  // 2. Probar endpoints directos
  for (const url of FXCC_CANDIDATES(refcat)) {
    try {
      const r = await fetchWithSession(url, jar);
      jar.addFromResponse(r);
      const ct = r.headers.get("content-type") ?? "";
      if (!r.ok) { await r.body?.cancel(); continue; }
      if (ct.toLowerCase().includes("pdf") || ct.includes("octet-stream")) {
        const buf = new Uint8Array(await r.arrayBuffer());
        if (looksLikePlantasPdf(buf, url)) {
          console.log("[fxcc] PDF obtenido de", url, "size=", buf.length);
          return { buf, url };
        }
      } else {
        // Es HTML — buscar enlace al PDF FXCC
        const html = await r.text();
        const hrefMatches = [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map((m) => m[1]);
        for (const h of hrefMatches) {
          const absUrl = h.startsWith("http") ? h : `${SEDE}${h.startsWith("/") ? h : "/" + h}`;
          if (!/plantas|FXCC|distribuc|PlanoEdif/i.test(absUrl)) continue;
          try {
            const r2 = await fetchWithSession(absUrl, jar, "application/pdf");
            if (!r2.ok) { await r2.body?.cancel(); continue; }
            const buf = new Uint8Array(await r2.arrayBuffer());
            if (looksLikePlantasPdf(buf, absUrl)) {
              console.log("[fxcc] PDF obtenido tras descubrir enlace", absUrl, "size=", buf.length);
              return { buf, url: absUrl };
            }
          } catch (_e) { /* ignore */ }
        }
      }
      await sleep(150);
    } catch (e) {
      console.warn("[fxcc] error en candidato", url, e);
    }
  }
  return null;
}

async function rasterizePdf(buf: Uint8Array, maxPages = 12, scale = 2): Promise<Uint8Array[]> {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { building_id, refcatastral, force } = await req.json();
    if (!building_id && !refcatastral) return err("building_id o refcatastral requerido", 400);

    const sb = getServiceClient();

    // Resolver refcatastral
    let refcat = refcatastral as string | undefined;
    if (!refcat) {
      const { data: b } = await sb.from("buildings").select("refcatastral").eq("id", building_id).maybeSingle();
      refcat = (b as any)?.refcatastral ?? undefined;
    }
    if (!refcat) return json({ status: "no_refcatastral" }, 200);

    // Si ya hay PDF disponible y no forzamos, salimos
    if (!force) {
      const { data: cd } = await sb.from("catastro_data").select("plantas_pdf_disponible, plantas_num_pages").eq("refcatastral", refcat).maybeSingle();
      if (cd && (cd as any).plantas_pdf_disponible && ((cd as any).plantas_num_pages ?? 0) > 0) {
        return json({ status: "already_available", refcat, num_pages: (cd as any).plantas_num_pages });
      }
    }

    const found = await tryFetchFxccPdf(refcat);
    if (!found) {
      console.log("[fxcc] no se encontró PDF FXCC para", refcat);
      return json({ status: "not_found", refcat });
    }

    // Upload PDF + páginas
    const pdfPath = `${refcat}_plantas.pdf`;
    await sb.storage.from("catastro").upload(pdfPath, found.buf, { contentType: "application/pdf", upsert: true });
    const plantas_pdf_url = sb.storage.from("catastro").getPublicUrl(pdfPath).data.publicUrl;

    let plantas_pages_urls: string[] = [];
    let plantas_num_pages = 0;
    try {
      const pages = await rasterizePdf(found.buf, 12, 2);
      plantas_num_pages = pages.length;
      for (let i = 0; i < pages.length; i++) {
        const pPath = `${refcat}_plantas_p${i + 1}.png`;
        await sb.storage.from("catastro").upload(pPath, pages[i], { contentType: "image/png", upsert: true });
        plantas_pages_urls.push(sb.storage.from("catastro").getPublicUrl(pPath).data.publicUrl);
      }
    } catch (e) {
      console.warn("[fxcc] raster fail", e);
    }

    await sb.from("catastro_data").update({
      plantas_pdf_url,
      plantas_pages_urls,
      plantas_num_pages: plantas_num_pages || null,
      plantas_pdf_disponible: true,
      fetch_quality: "high",
      fetched_at: new Date().toISOString(),
    }).eq("refcatastral", refcat);

    return json({
      status: "ok",
      refcat,
      source_url: found.url,
      num_pages: plantas_num_pages,
      pdf_url: plantas_pdf_url,
    });
  } catch (e) {
    console.error("fetch-fxcc-pdf error", e);
    return err(String((e as Error).message ?? e));
  }
});