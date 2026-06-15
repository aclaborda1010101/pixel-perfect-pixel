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
const MAX_JOBS_PER_RUN = 1; // tareas con navegador son pesadas

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

async function uploadText(
  supabase: any, jobId: string, fase: string, step: string, content: string, ext = "html",
): Promise<string | null> {
  const path = `evidence/${jobId}/${fase}/${Date.now()}_${step}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(
    path, new Blob([content], { type: ext === "html" ? "text/html" : "text/plain" }),
    { contentType: ext === "html" ? "text/html" : "text/plain", upsert: false },
  );
  if (error) { console.warn("upload text error", error.message); return null; }
  return path;
}

async function snapshot(
  supabase: any, page: any, jobId: string, fase: string, step: string, job: Job,
) {
  try {
    const buf = await page.screenshot({ type: "png", fullPage: false });
    const html = await page.content();
    const p1 = await uploadScreenshot(supabase, jobId, fase, step, buf);
    const p2 = await uploadText(supabase, jobId, fase, step, html, "html");
    job.datos.screenshots = job.datos.screenshots || [];
    if (p1) job.datos.screenshots.push({ step, path: p1, html: p2 });
  } catch (e) {
    console.warn("snapshot error", (e as any)?.message);
  }
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
  if (!BROWSER_WSS_URL) {
    await supabase.from("enrichment_jobs").update({
      estado: "esperando_navegador",
      datos: { ...job.datos, razon: "browser_no_configurado" },
      lease_token: null, lease_until: null,
    }).eq("id", job.id);
    return;
  }
  const slug = slugify(job.titular_nombre);
  const candidates: string[] = [`https://www.datoscif.es/empresa/${slug}`];
  if (job.titular_nif) candidates.push(`https://www.datoscif.es/cif/${job.titular_nif}`);

  let browser: any = null;
  try {
    const puppeteer = (await import("npm:puppeteer-core@22.15.0")).default;
    browser = await puppeteer.connect({ browserWSEndpoint: BROWSER_WSS_URL });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");
    page.setDefaultTimeout(20000);

    let found: any = null;
    for (const url of candidates) {
      pushTimeline(job, { fase: "datoscif", nota: `goto ${url}` });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        // Esperar a que el SPA pinte contenido relevante
        await page.waitForFunction(() => {
          const t = document.body?.innerText || "";
          return /CIF|Domicilio|Capital|Administrador|Objeto social/i.test(t) && t.length > 500;
        }, { timeout: 15000 }).catch(() => null);
        const text = await page.evaluate(() => document.body?.innerText || "");
        if (!text || text.length < 200 || /no encontrad|no existe|404/i.test(text.slice(0, 400))) {
          continue;
        }
        // Extracción DOM precisa: schema.org microdata + tabla de cargos
        const dom = await page.evaluate(() => {
          const txt = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() || null;
          const microItem = (prop: string) =>
            (document.querySelector(`[itemprop="${prop}"]`) as HTMLElement | null)?.innerText?.trim() || null;
          // Dirección
          const street = microItem("streetAddress");
          const cp = microItem("postalCode");
          const city = microItem("addressLocality");
          const region = microItem("addressRegion");
          const domicilio = [street, cp, city, region].filter(Boolean).join(", ") || null;
          // Cargos
          const cargos: { nombre: string; cargo: string; desde: string | null; hasta: string | null }[] = [];
          for (const tr of Array.from(document.querySelectorAll("#cargos_tabla tbody tr"))) {
            const cells = tr.querySelectorAll("td");
            if (cells.length < 2) continue;
            cargos.push({
              nombre: (cells[0] as HTMLElement).innerText.trim().replace(/\s+/g, " "),
              cargo: (cells[1] as HTMLElement).innerText.trim().replace(/\s+/g, " "),
              desde: cells[2] ? (cells[2] as HTMLElement).innerText.trim() || null : null,
              hasta: cells[3] ? (cells[3] as HTMLElement).innerText.trim() || null : null,
            });
          }
          // Capital actual: buscar última fila "Capital Actual:"
          let capital: string | null = null;
          const allTds = Array.from(document.querySelectorAll("td"));
          for (let i = 0; i < allTds.length; i++) {
            const t = (allTds[i] as HTMLElement).innerText.trim();
            if (/^Capital\s+Actual/i.test(t) && allTds[i + 1]) {
              const val = (allTds[i + 1] as HTMLElement).innerText.trim();
              const unit = allTds[i + 2] ? (allTds[i + 2] as HTMLElement).innerText.trim() : "";
              capital = `${val} ${unit}`.trim();
            }
          }
          // Fecha de constitución
          let fundacion: string | null = null;
          const all = document.body.innerText;
          const fm = all.match(/Fecha\s+de\s+Constituci[oó]n[\s\S]{0,40}?(\d{2}\/\d{2}\/\d{4})/i);
          if (fm) fundacion = fm[1];
          // Objeto social
          let objeto: string | null = null;
          const om = all.match(/Objeto\s+Social\s*\n+([\s\S]{20,1200}?)(?:\n\s*\n|Cambio de objeto|Capital\s+Social|Datos del Registro)/i);
          if (om) objeto = om[1].replace(/\s+/g, " ").trim();
          return {
            legalname: microItem("legalname"),
            taxId: microItem("taxID"),
            domicilio,
            cargos,
            capital,
            fundacion,
            objeto,
          };
        });
        // Extracción por bloques de texto plano renderizado
        const grab = (re: RegExp): string | null => {
          const m = text.match(re);
          return m ? m[1].trim().replace(/\s+/g, " ") : null;
        };
        const cif = dom.taxId || grab(/\b(?:CIF|NIF)\s*[:\-]?\s*([A-Z]\d{7}[A-Z0-9])\b/i);
        // Para domicilio, capital, objeto y fundación: aceptar saltos de línea entre etiqueta y valor
        const grabMulti = (re: RegExp): string | null => {
          const m = text.match(re);
          if (!m) return null;
          let v = m[1].trim().replace(/\s+/g, " ");
          // Si el "valor" capturado parece sólo un sub-encabezado (e.g. "social (2)"), descartar
          if (v.length < 6 || /^(social|\(\d+\))/i.test(v)) return null;
          return v;
        };
        const domicilio = dom.domicilio;
        const capital = dom.capital;
        const objeto = dom.objeto;
        const fundacion = dom.fundacion;
        // Administradores: filtrar a cargos de administración o representación
        const CARGO_OK = /Administrador|Presidente|Secretario|Vicepresidente|Consejero|Apoderado|Vocal|Director|Liquidador|Representante|Socio\s+Unico/i;
        const admins = (dom.cargos || []).filter(c => CARGO_OK.test(c.cargo));

        await snapshot(supabase, page, job.id, "datoscif", "render", job);

        const okFields = [cif, domicilio].filter(Boolean).length;
        if (okFields === 0 && admins.length === 0) {
          continue; // probar siguiente URL
        }
        found = { cif, domicilio, capital, objeto, fundacion, administradores: admins, fuente: url };
        break;
      } catch (e: any) {
        pushTimeline(job, { fase: "datoscif", nota: `error ${url}`, err: e.message });
      }
    }

    try { await page.close(); } catch {}

    if (!found) {
      await finishJob(supabase, job, {
        estado: "requiere_revision",
        error: "datoscif: empresa no encontrada",
        datos: { ...job.datos, razon: "datoscif_no_encontrado" },
      });
      return;
    }
    job.datos.datoscif = found;
    // Materializar SIEMPRE que tengamos CIF (idempotente)
    if (found.cif || job.titular_nif) {
      const matRes = await materializeCompany(supabase, job, found);
      job.datos.company_materializada = matRes;
    }
    // Si faltan campos clave → requiere_revision (no marcar como OK)
    const faltan: string[] = [];
    if (!found.cif) faltan.push("cif");
    if (!found.domicilio) faltan.push("domicilio");
    if (!found.administradores || !found.administradores.length) faltan.push("administradores");
    if (faltan.length) {
      pushTimeline(job, { fase: "datoscif", nota: "incompleto", faltan, payload: found });
      await finishJob(supabase, job, {
        estado: "requiere_revision",
        error: `datoscif: faltan campos ${faltan.join(",")}`,
        datos: { ...job.datos, razon: "datoscif_campos_vacios", faltan },
      });
      return;
    }
    pushTimeline(job, { fase: "datoscif", nota: "ok", payload: found });
    await finishJob(supabase, job, { estado: "ok", fase: "verificacion", datos: job.datos });
  } catch (e: any) {
    await finishJob(supabase, job, {
      estado: "error",
      error: `datoscif exception: ${e.message}`,
    });
  } finally {
    try { await browser?.disconnect(); } catch {}
  }
}

// ============ Materializar company desde datoscif ============
async function materializeCompany(supabase: any, job: Job, d: any) {
  const nombre = job.titular_nombre.trim();
  const cif = d.cif ?? job.titular_nif ?? null;
  // Buscar existente por CIF o nombre
  let existing: any = null;
  if (cif) {
    const { data } = await supabase.from("companies").select("id").eq("cif", cif).maybeSingle();
    existing = data;
  }
  if (!existing) {
    const { data } = await supabase.from("companies").select("id").ilike("nombre", nombre).maybeSingle();
    existing = data;
  }
  const founded_year = (() => {
    const m = (d.fundacion || "").match(/(19|20)\d{2}/);
    return m ? parseInt(m[0]) : null;
  })();
  const metadatos = {
    domicilio: d.domicilio ?? null,
    capital: d.capital ?? null,
    objeto: d.objeto ?? null,
    founded_year,
    administradores: d.administradores ?? [],
    fuente: d.fuente,
    fuente_at: new Date().toISOString(),
  };

  let companyId: string;
  if (existing) {
    companyId = existing.id;
    // merge metadatos
    const { data: prev } = await supabase.from("companies").select("metadatos, cif").eq("id", companyId).maybeSingle();
    await supabase.from("companies").update({
      cif: prev?.cif ?? cif,
      metadatos: { ...(prev?.metadatos || {}), ...metadatos },
    }).eq("id", companyId);
  } else {
    const { data: ins, error } = await supabase.from("companies").insert({
      nombre, cif, metadatos,
    }).select("id").maybeSingle();
    if (error) throw new Error(`companies insert: ${error.message}`);
    companyId = ins!.id;
  }

  let bcId: string | null = null;
  if (job.building_id) {
    const { data: bcEx } = await supabase
      .from("building_companies")
      .select("id")
      .eq("building_id", job.building_id)
      .eq("company_id", companyId)
      .eq("role", "titular")
      .maybeSingle();
    if (bcEx) {
      bcId = bcEx.id;
      await supabase.from("building_companies").update({
        percentage: job.datos?.raw?.porcentaje ?? job.datos?.raw?.pct ?? null,
        source: "enrichment:datoscif",
      }).eq("id", bcId);
    } else {
      const { data: bcIns, error } = await supabase.from("building_companies").insert({
        building_id: job.building_id,
        company_id: companyId,
        role: "titular",
        percentage: job.datos?.raw?.porcentaje ?? job.datos?.raw?.pct ?? null,
        source: "enrichment:datoscif",
      }).select("id").maybeSingle();
      if (error) console.warn("building_companies insert:", error.message);
      bcId = bcIns?.id ?? null;
    }
  }

  // Enlazar nota_simple_titulares si existe
  await supabase.from("nota_simple_titulares")
    .update({ company_id: companyId })
    .eq("building_id", job.building_id ?? "")
    .ilike("nombre", nombre);

  return { company_id: companyId, building_company_id: bcId };
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
    page.setDefaultTimeout(20000);
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36");

    // 1. login JSF
    pushTimeline(job, { fase: "inglobaly", nota: "login_start" });
    await page.goto("https://www.inglobaly.com/index.jsf", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));

    // 1a. aceptar cookies/consentimiento si existe
    const cookieClicked = await page.evaluate(() => {
      const re = /\b(aceptar|acepto|accept|ok|estoy de acuerdo|entendido|consent)\b/i;
      const cands = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button']"));
      for (const el of cands) {
        const t = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || "").trim();
        if (re.test(t)) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { (el as HTMLElement).click(); return t; }
        }
      }
      return null;
    });
    if (cookieClicked) {
      pushTimeline(job, { fase: "inglobaly", nota: "cookies_aceptadas", btn: cookieClicked });
      await new Promise((r) => setTimeout(r, 800));
    }

    // 1b. localizar selectores reales del formulario JSF (botón puede ser <a onclick=mojarra.jsfcljs...>)
    await page.waitForSelector("input[type='password']", { timeout: 20000 });
    const sels = await page.evaluate(() => {
      const pwd = document.querySelector("input[type='password']") as HTMLInputElement | null;
      if (!pwd) return null;
      const form = pwd.closest("form") as HTMLFormElement | null;
      const userEl = form?.querySelector("input[type='text'], input:not([type]), input[type='email']") as HTMLInputElement | null;
      // marcar botón con data-attr para click determinista por puppeteer
      const re = /acceso|acceder|entrar|^login$|sign in|enter|enviar/i;
      let btn: HTMLElement | null =
        (form?.querySelector("button[type='submit'], input[type='submit']") as HTMLElement | null);
      if (!btn) {
        btn = (Array.from(form?.querySelectorAll("a,button,input[type='button']") || []) as HTMLElement[])
          .find((e) => re.test(((e as HTMLElement).innerText || (e as HTMLInputElement).value || "").trim())) || null;
      }
      if (btn) btn.setAttribute("data-eagent-btn", "1");
      const idForSel = (el: Element | null) =>
        el ? (el.id ? `#${CSS.escape(el.id)}` : (el.getAttribute("name") ? `${el.tagName.toLowerCase()}[name='${el.getAttribute("name")}']` : null)) : null;
      return {
        userSel: idForSel(userEl),
        passSel: idForSel(pwd),
        btnSel: btn ? "[data-eagent-btn='1']" : null,
        btnTag: btn?.tagName.toLowerCase() || null,
        btnText: btn ? ((btn as HTMLElement).innerText || (btn as HTMLInputElement).value || "").trim() : null,
        btnOnclick: btn?.getAttribute("onclick") || null,
        formId: form?.id || null,
      };
    });
    pushTimeline(job, { fase: "inglobaly", nota: "login_selectores", ...(sels || {}) });
    if (!sels?.userSel || !sels?.passSel || !sels?.btnSel) {
      await snapshot(supabase, page, job.id, "inglobaly", "login_selectores_no_detectados", job);
      throw new Error("selector_no_encontrado:login_form");
    }

    // 1c. focus + type carácter a carácter (eventos input/change que JSF necesita)
    await page.click(sels.userSel, { clickCount: 3 }).catch(() => {});
    await page.type(sels.userSel, INGLOBALY_USER, { delay: 60 });
    await page.click(sels.passSel, { clickCount: 3 }).catch(() => {});
    await page.type(sels.passSel, INGLOBALY_PASS, { delay: 60 });
    // disparar blur/change explícito
    await page.evaluate((s: any) => {
      for (const sel of [s.userSel, s.passSel]) {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) continue;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
      }
    }, sels);

    // 1d. click real del botón Acceso (no requestSubmit) y esperar navegación o cambio de URL
    const urlBefore = page.url();
    await snapshot(supabase, page, job.id, "inglobaly", "pre_submit", job);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null),
      page.click(sels.btnSel).catch(async () => {
        // fallback: click via evaluate si .click() Puppeteer no engancha
        await page.evaluate((s: string) => {
          const el = document.querySelector(s) as HTMLElement | null;
          el?.click();
        }, sels.btnSel);
      }),
    ]);
    // espera extra por si el postback es ajax sin navegación
    await new Promise((r) => setTimeout(r, 2500));
    await snapshot(supabase, page, job.id, "inglobaly", "post_login", job);

    // 1e. VERIFICAR login: que no quedan campos login/pass y URL distinta a /index.jsf
    const verify = await page.evaluate(() => {
      const hasLogin = !!document.querySelector("input[type='password']");
      const url = location.href;
      const bodyText = (document.body.innerText || "").slice(0, 4000);
      const onlySearch = /only\s*search/i.test(bodyText);
      return { hasLogin, url, onlySearch };
    });
    pushTimeline(job, { fase: "inglobaly", nota: "login_verify", urlBefore, ...verify });
    const stillIndex = /\/index\.jsf(\?|$|#)/i.test(verify.url) || verify.url === urlBefore;
    if (verify.hasLogin || stillIndex) {
      await snapshot(supabase, page, job.id, "inglobaly", "login_failed_post_submit", job);
      await finishJob(supabase, job, {
        estado: "requiere_revision",
        error: `inglobaly: login_no_completado (url=${verify.url}, login_visible=${verify.hasLogin})`,
        datos: job.datos,
      });
      return;
    }
    pushTimeline(job, { fase: "inglobaly", nota: "login_ok", url: verify.url, only_search_visible: verify.onlySearch });

    // 2. localizar el buscador de la HOME bajo el texto "only search"
    //    Estrategia: encontrar el nodo que contiene el texto "only search"
    //    y tomar el primer <input> (type text/search) que aparezca DESPUÉS de él
    //    en orden de documento, dentro del mismo contenedor / hermano siguiente.
    const locateOnlySearchInput = async (): Promise<{ inputSel: string | null; mode: "exact" | "free"; debug: any }> => {
      return await page.evaluate(() => {
        function visible(el: Element) {
          const r = (el as HTMLElement).getBoundingClientRect();
          const s = getComputedStyle(el as HTMLElement);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        }
        function cssPath(el: Element): string {
          const e = el as HTMLElement;
          if (e.id) return `#${CSS.escape(e.id)}`;
          const name = e.getAttribute("name");
          if (name) return `${e.tagName.toLowerCase()}[name='${name}']`;
          const cls = (e.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
          // index among siblings of same tag
          const parent = e.parentElement;
          if (!parent) return e.tagName.toLowerCase();
          const sib = Array.from(parent.children).filter((n) => n.tagName === e.tagName);
          const idx = sib.indexOf(e) + 1;
          return `${cssPath(parent)} > ${e.tagName.toLowerCase()}${cls}:nth-of-type(${idx})`;
        }

        const re = /only\s*search/i;
        // Buscar todos los nodos cuyo texto directo contenga "only search"
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        const anchors: Element[] = [];
        let n: Node | null;
        while ((n = walker.nextNode())) {
          if (re.test(n.nodeValue || "")) {
            const p = (n.parentElement as Element) || null;
            if (p && visible(p)) anchors.push(p);
          }
        }
        const debug: any = { anchorCount: anchors.length, anchors: anchors.slice(0, 3).map((a) => (a as HTMLElement).innerText?.slice(0, 80)) };

        for (const anchor of anchors) {
          // Buscar inputs dentro del mismo contenedor padre cercano
          const containers = [anchor, anchor.parentElement, anchor.parentElement?.parentElement, anchor.parentElement?.parentElement?.parentElement].filter(Boolean) as Element[];
          for (const c of containers) {
            const inputs = Array.from(c.querySelectorAll("input")).filter((i) => {
              const el = i as HTMLInputElement;
              const t = (el.type || "text").toLowerCase();
              return ["text", "search", ""].includes(t) && visible(el);
            }) as HTMLInputElement[];
            // preferir uno que esté DESPUÉS del anchor en el documento
            const after = inputs.filter((i) => anchor.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
            const pick = after[0] || inputs[0];
            if (pick) {
              // detectar checkbox/toggle "exact"
              let mode: "exact" | "free" = "free";
              const around = (c.textContent || "").toLowerCase();
              if (/exact/.test(around)) mode = "exact";
              return { inputSel: cssPath(pick), mode, debug };
            }
          }
        }
        return { inputSel: null, mode: "free" as const, debug };
      });
    };

    const loc = await locateOnlySearchInput();
    pushTimeline(job, { fase: "inglobaly", nota: "only_search_locate", ...loc });
    job.datos.inglobaly_selectores = loc;

    if (!loc.inputSel) {
      // dump diagnóstico: URL, inputs visibles y textos candidatos
      const diag = await page.evaluate(() => {
        const url = location.href;
        const inputs = Array.from(document.querySelectorAll("input,textarea")).map((i) => {
          const el = i as HTMLInputElement;
          return {
            tag: el.tagName.toLowerCase(),
            type: el.type || "",
            name: el.getAttribute("name") || "",
            id: el.id || "",
            placeholder: el.placeholder || "",
            aria: el.getAttribute("aria-label") || "",
          };
        });
        // textos que contengan "search" o "buscar" o "only"
        const re = /search|buscar|only/i;
        const matches: string[] = [];
        document.querySelectorAll("body *").forEach((n) => {
          const t = (n as HTMLElement).innerText || "";
          if (t && t.length < 120 && re.test(t)) matches.push(t.trim());
        });
        return { url, inputs, texts: Array.from(new Set(matches)).slice(0, 30) };
      });
      pushTimeline(job, { fase: "inglobaly", nota: "home_diag", ...diag });
      job.datos.inglobaly_home_diag = diag;
      await snapshot(supabase, page, job.id, "inglobaly", "home_no_only_search", job);
      await finishJob(supabase, job, {
        estado: "requiere_revision",
        error: "inglobaly: no encontrado input bajo 'only search'",
        datos: job.datos,
      });
      return;
    }

    // 3. activar checkbox "exact" si existe
    await page.evaluate(() => {
      const re = /\bexact(o|a)?\b/i;
      const labels = Array.from(document.querySelectorAll("label"));
      for (const lab of labels) {
        if (!re.test((lab as HTMLElement).innerText || "")) continue;
        const forId = lab.getAttribute("for");
        const cb = (forId ? document.getElementById(forId) : lab.querySelector("input[type='checkbox'],input[type='radio']")) as HTMLInputElement | null;
        if (cb && !cb.checked) cb.click();
      }
    }).catch(() => {});

    // 4. introducir NIF preferente o nombre+apellidos
    const query = job.titular_nif || [job.titular_nombre, job.titular_apellido1, job.titular_apellido2].filter(Boolean).join(" ");
    pushTimeline(job, { fase: "inglobaly", nota: "search", query, by: job.titular_nif ? "nif" : "nombre" });
    await page.click(loc.inputSel, { clickCount: 3 }).catch(() => {});
    await page.type(loc.inputSel, query, { delay: 20 });

    // 5. submit: Enter dentro del input, y como fallback buscar botón "Buscar/Search" cercano
    await page.keyboard.press("Enter").catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate((sel: string) => {
      const inp = document.querySelector(sel) as HTMLInputElement | null;
      const form = inp?.closest("form");
      if (form) { (form as HTMLFormElement).requestSubmit?.(); return; }
      const re = /buscar|search/i;
      const scope = inp?.closest("section,div,form,article,main,body") || document.body;
      const btn = Array.from(scope.querySelectorAll("button,input[type='submit'],a")).find((n) => re.test((n as HTMLElement).innerText || (n as HTMLInputElement).value || "")) as HTMLElement | undefined;
      btn?.click();
    }, loc.inputSel).catch(() => {});

    await page.waitForFunction(() => {
      const t = document.body.innerText;
      return /resultado|encontrad|coincid|sin\s+resultado/i.test(t);
    }, { timeout: 20000 }).catch(() => null);
    await snapshot(supabase, page, job.id, "inglobaly", "resultados", job);

    // Abrir primer resultado si existe
    const opened = await page.evaluate(() => {
      const link = document.querySelector("table tbody tr a, .resultado a, ul.resultados a, a[href*='ficha'], a[href*='detalle']") as HTMLAnchorElement | null;
      if (link) { link.click(); return true; }
      return false;
    });
    if (opened) {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
      await snapshot(supabase, page, job.id, "inglobaly", "ficha", job);
    }

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
      ficha_abierta: opened,
    };
    pushTimeline(job, { fase: "inglobaly", nota: "ok", co_dom: coDom.length });
    // si no se abrió ficha o no se extrajo nada, marcar requiere_revision
    if (!opened || (!extracted.nif && extracted.domicilios.length === 0)) {
      await finishJob(supabase, job, {
        estado: "requiere_revision",
        error: "inglobaly: búsqueda sin resultados extraíbles",
        datos: job.datos,
      });
    } else {
      await finishJob(supabase, job, { estado: "ok", fase: "tecnofind", datos: job.datos });
    }
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
    try { await browser?.disconnect(); } catch {}
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