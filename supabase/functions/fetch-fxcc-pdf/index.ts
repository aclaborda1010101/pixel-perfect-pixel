// Edge function: fetch-fxcc-pdf
//
// El "FXCC" del Catastro es un visor 3D (Three.js) — NO existe endpoint
// público de descarga del PDF de plantas. Lo único descargable es el PDF
// genérico "Croquis y Datos" (SECImprimirCroquisYDatos.aspx) que SÍ incluye
// las plantas cuando el edificio tiene división horizontal con múltiples
// inmuebles (la PDF suele tener 5-15 páginas en ese caso).
//
// Esta función:
//   1. Resuelve el refcatastral COMPLETO (20 chars: rc14 + 0001XX) si solo
//      tenemos el de 14, usando OVCListaBienes.aspx.
//   2. Extrae del/mun (provincia/municipio) del HTML.
//   3. Descarga el PDF SECImprimirCroquisYDatos con sesión cookies.
//   4. Lo acepta solo si tiene >=4 páginas (heurística "tiene plantas").
//   5. Rasteriza a PNG y guarda en storage.

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

// Cookies simples
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

async function fetchWithSession(url: string, jar: CookieJar, accept = "application/pdf,text/html,*/*", referer?: string): Promise<Response> {
  return await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept": accept,
      "Accept-Language": "es-ES,es;q=0.9",
      "Cookie": jar.header(),
      "Referer": referer ?? `${SEDE}/CYCBienInmueble/OVCListaBienes.aspx`,
    },
    redirect: "follow",
  });
}

// Resuelve refcatastral 20-char + del/mun + lista de cargos visitando OVCListaBienes
async function resolveFullRefcat(rc14: string, jar: CookieJar): Promise<{
  full_rc: string | null;
  del: string | null;
  mun: string | null;
  all_cargos: string[];
} | null> {
  if (!/^[A-Z0-9]{14}$/i.test(rc14)) return null;
  const rc1 = rc14.slice(0, 7);
  const rc2 = rc14.slice(7);
  try {
    const url = `${SEDE}/CYCBienInmueble/OVCListaBienes.aspx?rc1=${rc1}&rc2=${rc2}`;
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" } });
    jar.addFromResponse(r);
    const html = await r.text();
    if (!html || html.length < 5000) return { full_rc: null, del: null, mun: null, all_cargos: [] };
    // refs completas en hrefs
    const refMatches = [...html.matchAll(/del=(\d+)&mun=(\d+)&refcat=([A-Z0-9]{20})/gi)];
    const all = Array.from(new Set(refMatches.map((m) => m[3])));
    const first = refMatches[0];
    return {
      full_rc: first?.[3] ?? null,
      del: first?.[1] ?? null,
      mun: first?.[2] ?? null,
      all_cargos: all,
    };
  } catch (e) {
    console.warn("[fxcc] resolveFullRefcat fail", e);
    return null;
  }
}

async function downloadPdfWithSession(url: string, jar: CookieJar): Promise<Uint8Array | null> {
  try {
    const r = await fetchWithSession(url, jar, "application/pdf,*/*");
    jar.addFromResponse(r);
    if (!r.ok) { await r.body?.cancel(); return null; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!isPdf(buf)) return null;
    return buf;
  } catch (_e) { return null; }
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

    const jar = new CookieJar();
    const rc14 = refcat.slice(0, 14);

    // 1. Resolver refcatastral COMPLETO (20 chars) + del/mun
    const resolved = await resolveFullRefcat(rc14, jar);
    if (!resolved || !resolved.full_rc) {
      return json({ status: "not_found_in_catastro", rc14 });
    }
    const fullRc = resolved.full_rc;
    const del = resolved.del!;
    const mun = resolved.mun!;
    console.log("[fxcc]", rc14, "→ full=", fullRc, "del=", del, "mun=", mun, "cargos=", resolved.all_cargos.length);

    // Si el ref guardado en buildings es de 14 chars, actualizar al full
    if (building_id) {
      const { data: b0 } = await sb.from("buildings").select("refcatastral").eq("id", building_id).maybeSingle();
      if ((b0 as any)?.refcatastral && (b0 as any).refcatastral.length < 20) {
        await sb.from("buildings").update({ refcatastral: fullRc }).eq("id", building_id);
      }
      // Asegurar fila en catastro_data
      await sb.from("catastro_data").upsert({
        refcatastral: fullRc,
        building_id,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "refcatastral" });
    }

    // 2. Si ya hay PDF y no forzamos, salimos
    if (!force) {
      const { data: cd } = await sb.from("catastro_data").select("plantas_pdf_disponible, plantas_num_pages").eq("refcatastral", fullRc).maybeSingle();
      if (cd && (cd as any).plantas_pdf_disponible && ((cd as any).plantas_num_pages ?? 0) >= 4) {
        return json({ status: "already_available", refcat: fullRc, num_pages: (cd as any).plantas_num_pages });
      }
    }

    // 3. Descargar SECImprimirCroquisYDatos con sesión (único PDF público con plantas)
    const pdfUrl = `${SEDE}/CYCBienInmueble/SECImprimirCroquisYDatos.aspx?del=${del}&mun=${mun}&refcat=${fullRc}`;
    const pdfBuf = await downloadPdfWithSession(pdfUrl, jar);
    if (!pdfBuf) {
      return json({ status: "pdf_fetch_failed", refcat: fullRc });
    }

    // 4. Validar páginas — solo aceptamos si tiene >=4 (indica plantas reales)
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(pdfBuf, "application/pdf");
    const totalPages = doc.countPages();
    doc.destroy();
    console.log("[fxcc] PDF", fullRc, "páginas=", totalPages, "size=", pdfBuf.length);
    if (totalPages < 4) {
      // PDF "ligero" (parcela única, sin plantas detalladas). No lo tratamos como FXCC.
      return json({ status: "pdf_too_short", refcat: fullRc, num_pages: totalPages });
    }
    const found = { buf: pdfBuf, url: pdfUrl };

    // Upload PDF + páginas
    const pdfPath = `${fullRc}_plantas.pdf`;
    await sb.storage.from("catastro").upload(pdfPath, found.buf, { contentType: "application/pdf", upsert: true });
    const plantas_pdf_url = sb.storage.from("catastro").getPublicUrl(pdfPath).data.publicUrl;

    let plantas_pages_urls: string[] = [];
    let plantas_num_pages = 0;
    try {
      const pages = await rasterizePdf(found.buf, 12, 2);
      plantas_num_pages = pages.length;
      for (let i = 0; i < pages.length; i++) {
        const pPath = `${fullRc}_plantas_p${i + 1}.png`;
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
    }).eq("refcatastral", fullRc);

    return json({
      status: "ok",
      refcat: fullRc,
      source_url: found.url,
      num_pages: plantas_num_pages,
      pdf_url: plantas_pdf_url,
    });
  } catch (e) {
    console.error("fetch-fxcc-pdf error", e);
    return err(String((e as Error).message ?? e));
  }
});