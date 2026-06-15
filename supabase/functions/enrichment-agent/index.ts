// Enrichment agent: drena enrichment_jobs por fases.
// Llamado por pg_cron cada 15 min y por enrichment-pipeline-start manualmente.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAW_BROWSER_WSS = Deno.env.get("BROWSER_WSS_URL") ?? "";
// Browserless: /stealth/bql es BrowserQL (no Puppeteer). Para puppeteer-core
// usar el endpoint base conservando el token.
function toPuppeteerWss(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    u.pathname = "/";
    return u.toString().replace(/\/$/, "") + (u.search ? "" : "");
  } catch {
    return raw;
  }
}
const BROWSER_WSS_URL = toPuppeteerWss(RAW_BROWSER_WSS);
const INGLOBALY_USER = Deno.env.get("INGLOBALY_USER") ?? "";
const INGLOBALY_PASS = Deno.env.get("INGLOBALY_PASS") ?? "";
const BUCKET = "enrichment-evidence";
const MAX_JOBS_PER_RUN = 8;

type Job = {
  id: string;
  building_id: string | null;
  titular_nombre: string;
  titular_apellido1: string | null;
  titular_apellido2: string | null;
  titular_tipo: "persona" | "empresa";
  titular_nif: string | null;
  fase: string;
  estado: string;
  datos: any;
  intentos: number;
  max_intentos: number;
};

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function backoffSeconds(intentos: number): number {
  const series = [60, 300, 1800];
  return series[Math.min(intentos, series.length - 1)];
}

async function uploadScreenshot(
  supabase: any, jobId: string, fase: string, step: string, buf: Uint8Array,
): Promise<string | null> {
  const path = `evidence/${jobId}/${fase}/${Date.now()}_${step}.png`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: "image/png", upsert: false,
  });
  if (error) { console.warn("upload screenshot error", error.message); return null; }
  return path;
}

function pushTimeline(job: Job, entry: any) {
  job.datos.timeline = Array.isArray(job.datos.timeline) ? job.datos.timeline : [];
  job.datos.timeline.push({ ts: new Date().toISOString(), ...entry });
}

async function finishJob(
  supabase: any, job: Job,
  patch: { estado: string; fase?: string; error?: string | null; datos?: any },
) {
  const isRetryError = patch.estado === "error" && job.intentos + 1 < job.max_intentos;
  const update: any = {
    estado: isRetryError ? "pendiente" : patch.estado,
    fase: patch.fase ?? job.fase,
    datos: patch.datos ?? job.datos,
    error: patch.error ?? null,
    intentos: job.intentos + (patch.estado === "ok" ? 0 : 1),
    lease_token: null,
    lease_until: null,
  };
  if (isRetryError) {
    update.next_attempt_at = new Date(Date.now() + backoffSeconds(job.intentos) * 1000).toISOString();
  }
  await supabase.from("enrichment_jobs").update(update).eq("id", job.id);

  // si llega a fase verificacion, crear registro pendiente
  if (update.fase === "verificacion" && update.estado === "ok") {
    await supabase.from("enrichment_verifications").insert({
      job_id: job.id,
      propuesta: job.datos,
      decision: "pendiente",
    });
  }
}

// ============ Fase datoscif ============
async function handleDatoscif(supabase: any, job: Job) {
  const slug = slugify(job.titular_nombre);
  const url = `https://www.datoscif.es/empresa/${slug}`;
  pushTimeline(job, { fase: "datoscif", nota: `fetch ${url}` });
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AffluxBot/1.0)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      await finishJob(supabase, job, {
        estado: "requiere_revision",
        error: `datoscif http ${res.status}`,
        datos: { ...job.datos, razon: "datoscif_no_encontrado" },
      });
      return;
    }
    const html = await res.text();
    // Extracción mínima por regex; si no encontramos NADA → requiere_revision
    const cifMatch = html.match(/CIF[^A-Z0-9]*([A-Z]\d{8})/i);
    const domicilioMatch = html.match(/Domicilio[^<]*<[^>]+>([^<]{5,200})</i);
    const adminMatch = [...html.matchAll(/Administrador[^<]*<[^>]+>([^<]{3,120})</gi)]
      .map(m => m[1].trim());

    if (!cifMatch && !domicilioMatch && adminMatch.length === 0) {
      // probable client-rendered o empresa no existente
      await finishJob(supabase, job, {
        estado: "requiere_revision",
        error: "html sin datos estructurados",
        datos: { ...job.datos, razon: "datoscif_client_rendered_o_no_existe" },
      });
      return;
    }
    job.datos.datoscif = {
      cif: cifMatch?.[1] ?? null,
      domicilio: domicilioMatch?.[1]?.trim() ?? null,
      administradores: adminMatch,
      fuente: url,
    };
    pushTimeline(job, { fase: "datoscif", nota: "ok", payload: job.datos.datoscif });
    await finishJob(supabase, job, { estado: "ok", fase: "verificacion", datos: job.datos });
  } catch (e: any) {
    await finishJob(supabase, job, {
      estado: "error",
      error: `datoscif exception: ${e.message}`,
    });
  }
}

// ============ Fase inglobaly (navegador headless) ============
async function handleInglobaly(supabase: any, job: Job) {
  if (!BROWSER_WSS_URL || !INGLOBALY_USER || !INGLOBALY_PASS) {
    pushTimeline(job, { fase: "inglobaly", nota: "browser/credenciales no configurados" });
    await supabase.from("enrichment_jobs").update({
      estado: "esperando_navegador",
      datos: { ...job.datos, razon: "browser_no_configurado" },
      lease_token: null, lease_until: null,
    }).eq("id", job.id);
    return;
  }

  let browser: any = null;
  try {
    const puppeteer = (await import("npm:puppeteer-core@22.15.0")).default;
    browser = await puppeteer.connect({ browserWSEndpoint: BROWSER_WSS_URL });
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);

    // Helper puppeteer-core para "click on element containing text"
    const clickByText = async (selector: string, text: string) => {
      const handle = await page.evaluateHandle((sel: string, t: string) => {
        const nodes = Array.from(document.querySelectorAll(sel));
        const re = new RegExp(t, "i");
        return nodes.find((n) => re.test(n.textContent || "")) || null;
      }, selector, text);
      const el = handle.asElement();
      if (!el) throw new Error(`element_not_found:${selector}:${text}`);
      await el.click();
    };

    const step = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
        const buf = await page.screenshot({ type: "png" });
        const p = await uploadScreenshot(supabase, job.id, "inglobaly", name, buf);
        if (p) {
          job.datos.screenshots = job.datos.screenshots || [];
          job.datos.screenshots.push({ step: name, path: p });
        }
        pushTimeline(job, { fase: "inglobaly", nota: name });
      } catch (e: any) {
        const buf = await page.screenshot({ type: "png" }).catch(() => null);
        if (buf) await uploadScreenshot(supabase, job.id, "inglobaly", `${name}_FAIL`, buf);
        throw new Error(`selector_no_encontrado:${name}: ${e.message}`);
      }
    };

    await step("goto", async () => {
      await page.goto("https://www.inglobaly.com", { waitUntil: "domcontentloaded" });
    });
    await step("click_acceso", async () => {
      await clickByText("a, button", "Acceso|Iniciar|Login|Entrar");
    });
    await step("login", async () => {
      await page.waitForSelector("input[type='email'], input[name='usuario'], input[name='email'], #usuario");
      const userSel = "input[type='email'], input[name='usuario'], input[name='email'], #usuario";
      const passSel = "input[type='password'], input[name='password'], #password";
      await page.type(userSel, INGLOBALY_USER);
      await page.type(passSel, INGLOBALY_PASS);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
        page.click("button[type='submit'], input[type='submit']"),
      ]);
    });

    // Búsqueda
    if (job.titular_nif) {
      await step("search_nif", async () => {
        await page.waitForSelector("input[name='nif'], #nif, input[placeholder*='NIF' i]");
        await page.type("input[name='nif'], #nif, input[placeholder*='NIF' i]", job.titular_nif!);
        await clickByText("button", "Buscar");
      });
    } else {
      await step("search_exact", async () => {
        await page.waitForSelector("input[name='nombre'], #nombre, input[placeholder*='Nombre' i]");
        await page.type("input[name='nombre'], #nombre, input[placeholder*='Nombre' i]", job.titular_nombre);
        if (job.titular_apellido1) {
          await page.type("input[name='apellido1'], #apellido1, input[placeholder*='Apellido' i]", job.titular_apellido1).catch(()=>{});
        }
        if (job.titular_apellido2) {
          await page.type("input[name='apellido2'], #apellido2", job.titular_apellido2).catch(()=>{});
        }
        await clickByText("button", "Buscar");
      });
    }

    await step("abrir_ficha", async () => {
      await page.waitForSelector("table tbody tr a, .resultado a", { timeout: 15000 });
      await page.click("table tbody tr a, .resultado a");
    });

    const extracted = await page.evaluate(() => {
      const txt = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? "";
      const nif = txt(".cabecera .nif, [data-field='nif']");
      const fNac = txt(".cabecera .fecha-nacimiento, [data-field='fecha_nacimiento']");
      const domicilios: { tipo: string; direccion: string; convivientes: any[] }[] = [];
      document.querySelectorAll(".domicilio").forEach((d) => {
        const tipo = d.querySelector(".tipo")?.textContent?.trim() ?? "";
        const dir = d.querySelector(".direccion")?.textContent?.trim() ?? "";
        const convivientes: any[] = [];
        d.querySelectorAll(".conviviente").forEach((c) => {
          convivientes.push({
            nombre: c.querySelector(".nombre")?.textContent?.trim() ?? "",
            nif: c.querySelector(".nif")?.textContent?.trim() ?? "",
          });
        });
        domicilios.push({ tipo, direccion: dir, convivientes });
      });
      return { nif, fNac, domicilios };
    });

    // Convertir DD/MM/AAAA → YYYY-MM-DD
    const fNacIso = (() => {
      const m = (extracted.fNac || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
    })();

    // Dedupe co-domicilios por NIF
    const seen = new Set<string>();
    const coDom: any[] = [];
    for (const d of extracted.domicilios) {
      for (const c of d.convivientes) {
        const key = (c.nif || c.nombre).toUpperCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        coDom.push({ ...c, domicilio_tipo: d.tipo, direccion: d.direccion });
      }
    }

    job.datos.inglobaly = {
      nif: extracted.nif || job.titular_nif,
      fecha_nacimiento: fNacIso,
      domicilios: extracted.domicilios,
      co_domicilios: coDom,
      fuente: "inglobaly",
    };
    pushTimeline(job, { fase: "inglobaly", nota: "ok", co_dom: coDom.length });
    await finishJob(supabase, job, { estado: "ok", fase: "tecnofind", datos: job.datos });
  } catch (e: any) {
    const msg = e.message || String(e);
    const reqRev = msg.startsWith("selector_no_encontrado");
    pushTimeline(job, { fase: "inglobaly", nota: "fail", error: msg });
    await finishJob(supabase, job, {
      estado: reqRev ? "requiere_revision" : "error",
      error: msg,
      datos: job.datos,
    });
  } finally {
    try { await browser?.close(); } catch {}
  }
}

// ============ Fase tecnofind (no automatizada) ============
async function handleTecnofind(supabase: any, job: Job) {
  const tienePhone = !!job.datos?.telefono;
  if (!tienePhone && job.building_id) {
    await supabase.from("building_tasks").insert({
      building_id: job.building_id,
      titulo: `Buscar teléfono en Tecnofind — ${job.titular_nombre}`,
      tipo: "investigacion",
      estado: "pendiente",
      metadatos: { enrichment_job_id: job.id, titular: job.titular_nombre },
    });
    pushTimeline(job, { fase: "tecnofind", nota: "tarea creada" });
  }
  await finishJob(supabase, job, { estado: "ok", fase: "verificacion", datos: job.datos });
}

// ============ Loop ============
async function drainOnce(supabase: any) {
  // Claim pending jobs
  const lease = crypto.randomUUID();
  const { data: claimed, error } = await supabase
    .from("enrichment_jobs")
    .update({
      estado: "en_curso",
      lease_token: lease,
      lease_until: new Date(Date.now() + 120000).toISOString(),
    })
    .eq("estado", "pendiente")
    .lte("next_attempt_at", new Date().toISOString())
    .in("fase", ["datoscif", "inglobaly", "tecnofind"])
    .select("*")
    .limit(MAX_JOBS_PER_RUN);
  if (error) throw error;
  const jobs = (claimed ?? []) as Job[];
  if (!jobs.length) return { processed: 0 };

  for (const job of jobs) {
    try {
      if (job.fase === "datoscif") await handleDatoscif(supabase, job);
      else if (job.fase === "inglobaly") await handleInglobaly(supabase, job);
      else if (job.fase === "tecnofind") await handleTecnofind(supabase, job);
    } catch (e: any) {
      await finishJob(supabase, job, { estado: "error", error: e.message });
    }
  }
  return { processed: jobs.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const result = await drainOnce(supabase);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});