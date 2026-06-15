// Diagnóstico rápido de la integración con Browserless.
// GET → conecta a BROWSER_WSS_URL, abre about:blank, devuelve versión + título.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const RAW_WSS = Deno.env.get("BROWSER_WSS_URL") ?? "";

// Browserless: /stealth/bql es BrowserQL (GraphQL), no Puppeteer/CDP.
// Para puppeteer-core hay que conectar al endpoint base (sin path) conservando el token.
function toPuppeteerWss(raw: string): string {
  try {
    const u = new URL(raw);
    u.pathname = "/";
    return u.toString().replace(/\/$/, "") + (u.search ? "" : "");
  } catch {
    return raw;
  }
}
const BROWSER_WSS_URL = toPuppeteerWss(RAW_WSS);

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
    await page.goto("https://example.com", { waitUntil: "load", timeout: 20000 });
    const title = await page.title();
    const url = page.url();
    out.ok = true;
    out.version = version;
    out.test_title = title;
    out.test_url = url;
    out.endpoint = BROWSER_WSS_URL.replace(/token=[^&]+/, "token=***");
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