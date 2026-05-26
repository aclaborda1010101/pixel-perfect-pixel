// Edge function: upload-fxcc-pdf
// Recibe un PDF FXCC (croquis por plantas del Catastro) subido manualmente
// desde la ficha del edificio, lo rasteriza a páginas JPG y lo registra en
// catastro_data como fxcc_pdf_url / fxcc_pages_urls / fxcc_num_pages.
import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

// deno-lint-ignore no-explicit-any
let _mupdf: any = null;
async function getMupdf() {
  if (_mupdf) return _mupdf;
  _mupdf = await import("npm:mupdf@1.3.0");
  return _mupdf;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isPdf(buf: Uint8Array): boolean {
  return buf.length > 1000 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const body = await req.json();
    const building_id = String(body?.building_id ?? "");
    const content_base64 = String(body?.content_base64 ?? "");
    if (!building_id || !content_base64) return err("building_id y content_base64 requeridos", 400);

    const sb = getServiceClient();

    const { data: b } = await sb.from("buildings").select("refcatastral").eq("id", building_id).maybeSingle();
    const refcat: string | null = (b as any)?.refcatastral ?? null;
    if (!refcat) return err("edificio sin refcatastral", 400);
    const rc14 = refcat.slice(0, 14);

    const pdfBuf = base64ToBytes(content_base64);
    if (!isPdf(pdfBuf)) return err("el archivo no es un PDF válido", 400);

    // Subir PDF
    const pdfPath = `${rc14}_fxcc.pdf`;
    const { error: upErr } = await sb.storage.from("catastro").upload(pdfPath, pdfBuf, {
      contentType: "application/pdf", upsert: true,
    });
    if (upErr) throw upErr;
    const fxcc_pdf_url = sb.storage.from("catastro").getPublicUrl(pdfPath).data.publicUrl;

    // Rasterizar
    const mupdf = await getMupdf();
    const doc = mupdf.Document.openDocument(pdfBuf, "application/pdf");
    const n = Math.min(doc.countPages(), 20);
    const urls: string[] = [];
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
      const png = pixmap.asPNG();
      pixmap.destroy();
      page.destroy();
      const path = `${rc14}_fxcc_p${i + 1}.png`;
      const { error: e2 } = await sb.storage.from("catastro").upload(path, png, {
        contentType: "image/png", upsert: true,
      });
      if (e2) throw e2;
      urls.push(sb.storage.from("catastro").getPublicUrl(path).data.publicUrl);
    }
    doc.destroy();

    // Asegurar fila catastro_data
    const { data: existing } = await sb.from("catastro_data").select("refcatastral").eq("building_id", building_id).maybeSingle();
    if (!existing) {
      await sb.from("catastro_data").insert({
        building_id,
        refcatastral: refcat,
        fetched_at: new Date().toISOString(),
      });
    }

    await sb.from("catastro_data").update({
      fxcc_pdf_url,
      fxcc_pages_urls: urls,
      fxcc_num_pages: urls.length,
      fxcc_disponible: true,
      fxcc_source: "manual",
      updated_at: new Date().toISOString(),
    }).eq("building_id", building_id);

    return json({ status: "ok", num_pages: urls.length, pdf_url: fxcc_pdf_url, pages: urls });
  } catch (e) {
    console.error("upload-fxcc-pdf error", e);
    return err(String((e as Error).message ?? e));
  }
});