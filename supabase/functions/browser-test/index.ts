// Diagnóstico rápido de la integración con Browserless.
// GET → conecta a BROWSER_WSS_URL, abre about:blank, devuelve versión + título.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BROWSER_WSS_URL = Deno.env.get("BROWSER_WSS_URL") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const out: any = { ok: false, has_wss: !!BROWSER_WSS_URL };
  if (!BROWSER_WSS_URL) {
    return new Response(JSON.stringify({ ...out, error: "BROWSER_WSS_URL no configurado" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let browser: any = null;
  const started = Date.now();
  try {
    const puppeteer = (await import("npm:puppeteer-core@22.15.0")).default;
    browser = await puppeteer.connect({ browserWSEndpoint: BROWSER_WSS_URL });
    const version = await browser.version();
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto("https://www.inglobaly.com", { waitUntil: "domcontentloaded" });
    const title = await page.title();
    const url = page.url();
    out.ok = true;
    out.version = version;
    out.inglobaly_title = title;
    out.inglobaly_url = url;
    out.elapsed_ms = Date.now() - started;
    await page.close();
  } catch (e: any) {
    out.error = e?.message ?? String(e);
    out.elapsed_ms = Date.now() - started;
  } finally {
    try { if (browser) await browser.disconnect(); } catch (_) {}
  }

  return new Response(JSON.stringify(out, null, 2), {
    status: out.ok ? 200 : 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});