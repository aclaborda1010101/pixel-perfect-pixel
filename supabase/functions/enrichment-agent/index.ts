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
        // Extracción DOM: para cada label conocido, encontrar el valor en la celda/elemento contiguo
        const labelMap = await page.evaluate(() => {
          const LABELS = ["CIF","Domicilio Social","Domicilio","Capital Social","Capital","Objeto Social","Fecha de Constitución","Forma Jurídica"];
          const out: Record<string, string[]> = {};
          const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
          const isLabel = (el: Element, label: string) => {
            const t = norm((el as HTMLElement).innerText || el.textContent || "");
            return t.toLowerCase() === label.toLowerCase() || t.toLowerCase().startsWith(label.toLowerCase() + " (");
          };
          const collect = (label: string, value: string) => {
            if (!value) return;
            const v = norm(value);
            if (v.length < 2 || v.toLowerCase() === label.toLowerCase()) return;
            out[label] = out[label] || [];
            if (!out[label].includes(v)) out[label].push(v);
          };
          // Buscar en pares estándar dt/dd, th/td, label/value
          for (const label of LABELS) {
            // dt -> dd
            for (const dt of Array.from(document.querySelectorAll("dt,th,strong,b,span.label,div.label"))) {
              if (!isLabel(dt, label)) continue;
              const dd = dt.nextElementSibling || (dt.parentElement && dt.parentElement.nextElementSibling);
              if (dd) collect(label, (dd as HTMLElement).innerText || dd.textContent || "");
            }
            // tr con dos celdas: primera = label
            for (const tr of Array.from(document.querySelectorAll("tr"))) {
              const cells = tr.querySelectorAll("td,th");
              if (cells.length >= 2 && isLabel(cells[0], label)) {
                collect(label, (cells[1] as HTMLElement).innerText || cells[1].textContent || "");
              }
            }
            // Bloques tipo card: <div>Label</div><div>Value</div>
            for (const div of Array.from(document.querySelectorAll("div,p,li"))) {
              const txt = norm((div as HTMLElement).innerText || "");
              if (txt.toLowerCase().startsWith(label.toLowerCase() + ":")) {
                collect(label, txt.slice(label.length + 1));
              }
            }
          }
          return out;
        });
        const pick = (k: string) => (labelMap[k] && labelMap[k][0]) || null;
        // Extracción por bloques de texto plano renderizado
        const grab = (re: RegExp): string | null => {
          const m = text.match(re);
          return m ? m[1].trim().replace(/\s+/g, " ") : null;
        };
        const cifFromMap = pick("CIF");
        const cif = (cifFromMap && /[A-Z]\d{7}[A-Z0-9]/i.test(cifFromMap)
          ? cifFromMap.match(/[A-Z]\d{7}[A-Z0-9]/i)![0]
          : null) || grab(/\b(?:CIF|NIF)\s*[:\-]?\s*([A-Z]\d{7}[A-Z0-9])\b/i);
        // Para domicilio, capital, objeto y fundación: aceptar saltos de línea entre etiqueta y valor
        const grabMulti = (re: RegExp): string | null => {
          const m = text.match(re);
          if (!m) return null;
          let v = m[1].trim().replace(/\s+/g, " ");
          // Si el "valor" capturado parece sólo un sub-encabezado (e.g. "social (2)"), descartar
          if (v.length < 6 || /^(social|\(\d+\))/i.test(v)) return null;
          return v;
        };
        const domicilio = pick("Domicilio Social") || pick("Domicilio") ||
          grabMulti(/Domicilio\s+social[^\n]*\n+\s*([^\n]{10,200})/i);
        const capital = pick("Capital Social") || pick("Capital") ||
          grabMulti(/Capital(?:\s+social)?[^\n]*\n+\s*([^\n]{2,80})/i);
        const objeto = pick("Objeto Social") ||
          grabMulti(/Objeto\s+social[^\n]*\n+\s*([^\n]{5,500})/i);
        const fundacionRaw = pick("Fecha de Constitución") ||
          grab(/(?:Fecha\s+de\s+constituci[oó]n|Constituida)[^:\n]*[:\-]\s*([^\n]{4,40})/i);
        const fundacion = fundacionRaw && /\d{2}\/\d{2}\/\d{4}|\d{4}/.test(fundacionRaw) ? fundacionRaw : null;
        // Administradores: bloque tras "Administrador" / "Organigrama" / "Cargos"
        const admins: { cargo: string | null; nombre: string }[] = [];
        const STOP = /VINCULACIONES|Empresas\s+relacionadas|Cuentas\s+anuales|Balance|Sector|Web|Email|Teléfono|©|Política/i;
        const NOISE = /^(ORGANIGRAMA|VINCULACIONES|Actuales|Sólo\s+Antiguas|Ver\s+Todas|Consejeros|Cualquiera|Solo\s+apoderamos|Apoderamos|Antiguas|Cargos)\b/i;
        const CARGO_RE = /^(Administrador(?:\s+(?:Único|Unico|Solidario|Mancomunado|Conjunto|Suplente))?|Presidente|Secretario|Vicepresidente|Consejero(?:\s+Delegado)?|Apoderado|Vocal|Director(?:\s+General)?|Liquidador)\b/i;
        const admBlock = text.match(/(?:ORGANIGRAMA[\s\S]*?|Administrador(?:es)?|Órgano\s+de\s+administraci[oó]n)[\s\S]{0,3000}/i);
        if (admBlock) {
          const lines = admBlock[0].split(/\n+/).map((s: string) => s.trim()).filter(Boolean);
          let lastCargo: string | null = null;
          for (const ln of lines) {
            if (STOP.test(ln)) break;
            if (NOISE.test(ln)) continue;
            if (CARGO_RE.test(ln)) { lastCargo = ln; continue; }
            // Línea con apariencia de nombre/razón social (>=2 palabras o termina en SL/SA/SLU)
            if (/[A-ZÁÉÍÓÚÑ]/.test(ln) &&
                (/\b(SL|SA|SLU|SAU|SLNE|SCP|CB|COOP)\b\.?$/i.test(ln) ||
                 /^([A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚÑáéíóúñ\.\-']*\s+){1,5}[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚÑáéíóúñ\.\-']*$/.test(ln) ||
                 /^[A-ZÁÉÍÓÚÑ\s\.\-']{6,80}$/.test(ln))) {
              admins.push({ cargo: lastCargo, nombre: ln });
              if (admins.length >= 15) break;
            }
          }
        }

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

    // 1. login
    pushTimeline(job, { fase: "inglobaly", nota: "login" });
    await page.goto("https://www.inglobaly.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    // intentar abrir login si hay enlace
    await page.evaluate(() => {
      const re = /acceso|iniciar|login|entrar|acceder/i;
      const el = Array.from(document.querySelectorAll("a,button"))
        .find((n) => re.test((n as HTMLElement).innerText || "")) as HTMLElement | undefined;
      el?.click();
    }).catch(() => {});
    await page.waitForSelector("input[type='password']", { timeout: 20000 });
    const userSel = await page.evaluate(() => {
      const cand = document.querySelectorAll("input[type='email'], input[type='text'], input:not([type])");
      for (const i of Array.from(cand)) {
        const el = i as HTMLInputElement;
        if (el.type === "password" || el.type === "hidden") continue;
        return el.name ? `input[name='${el.name}']` : `#${el.id}`;
      }
      return null;
    });
    if (!userSel) throw new Error("login_input_no_encontrado");
    await page.type(userSel, INGLOBALY_USER, { delay: 30 });
    await page.type("input[type='password']", INGLOBALY_PASS, { delay: 30 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null),
      page.evaluate(() => {
        const btn = document.querySelector("button[type='submit'], input[type='submit']") as HTMLElement | null;
        btn?.click();
      }),
    ]);
    await snapshot(supabase, page, job.id, "inglobaly", "post_login", job);

    // 2. ir a la página de búsqueda — probar rutas conocidas
    const searchRoutes = [
      "https://www.inglobaly.com/buscar",
      "https://www.inglobaly.com/busqueda",
      "https://www.inglobaly.com/search",
      "https://www.inglobaly.com/panel/buscar",
    ];
    let searchOk = false;
    for (const r of searchRoutes) {
      try {
        await page.goto(r, { waitUntil: "domcontentloaded", timeout: 20000 });
        const has = await page.evaluate(() => /N\.?I\.?F\.?|Nombre|Apellido/i.test(document.body.innerText));
        if (has) { searchOk = true; break; }
      } catch {}
    }
    if (!searchOk) {
      // fallback: quedarnos en la página actual tras login
      pushTimeline(job, { fase: "inglobaly", nota: "search_route_no_detectada, usando home post-login" });
    }
    await snapshot(supabase, page, job.id, "inglobaly", "search_form_dump", job);

    // 3. localizar inputs por etiqueta
    const inputForLabel = async (labelRe: string): Promise<string | null> => {
      return await page.evaluate((reSrc: string) => {
        const re = new RegExp(reSrc, "i");
        // a) <label for="...">
        for (const lab of Array.from(document.querySelectorAll("label"))) {
          const txt = (lab as HTMLElement).innerText || "";
          if (!re.test(txt)) continue;
          const forId = lab.getAttribute("for");
          if (forId && document.getElementById(forId)) return `#${CSS.escape(forId)}`;
          const inner = lab.querySelector("input,select,textarea") as HTMLElement | null;
          if (inner) {
            if (inner.id) return `#${CSS.escape(inner.id)}`;
            const name = inner.getAttribute("name");
            if (name) return `${inner.tagName.toLowerCase()}[name='${name}']`;
          }
        }
        // b) placeholder/aria
        for (const i of Array.from(document.querySelectorAll("input,textarea"))) {
          const el = i as HTMLInputElement;
          const ph = el.placeholder || el.getAttribute("aria-label") || el.getAttribute("title") || "";
          if (re.test(ph)) {
            if (el.id) return `#${CSS.escape(el.id)}`;
            const name = el.getAttribute("name");
            if (name) return `${el.tagName.toLowerCase()}[name='${name}']`;
          }
        }
        // c) name="nif|nombre|apellido"
        const byName = document.querySelector(`input[name*='${reSrc.toLowerCase()}' i]`);
        if (byName) {
          const n = (byName as HTMLInputElement).getAttribute("name");
          return n ? `input[name='${n}']` : null;
        }
        return null;
      }, labelRe);
    };

    const nifSel = await inputForLabel("N\\.?I\\.?F|NIF|CIF|Documento");
    const nombreSel = await inputForLabel("^Nombre$|Nombre$|Nombre\\b");
    const ap1Sel = await inputForLabel("Apellido\\s*1|Primer\\s+apellido|^Apellido$");
    const ap2Sel = await inputForLabel("Apellido\\s*2|Segundo\\s+apellido");

    pushTimeline(job, { fase: "inglobaly", nota: "selectores", nifSel, nombreSel, ap1Sel, ap2Sel });
    job.datos.inglobaly_selectores = { nifSel, nombreSel, ap1Sel, ap2Sel };

    const buscarBtn = async () => {
      return await page.evaluate(() => {
        const re = /buscar|search/i;
        const cands = Array.from(document.querySelectorAll("button,input[type='submit'],a"));
        const el = cands.find((n) => re.test(((n as HTMLElement).innerText || (n as HTMLInputElement).value || "")));
        if (!el) return false;
        (el as HTMLElement).click();
        return true;
      });
    };

    // 4. ejecutar búsqueda preferente por NIF
    if (job.titular_nif && nifSel) {
      pushTimeline(job, { fase: "inglobaly", nota: "search_nif", nif: job.titular_nif });
      await page.click(nifSel, { clickCount: 3 }).catch(() => {});
      await page.type(nifSel, job.titular_nif);
      const clicked = await buscarBtn();
      if (!clicked) throw new Error("boton_buscar_no_encontrado");
    } else if (nombreSel) {
      pushTimeline(job, { fase: "inglobaly", nota: "search_nombre" });
      await page.click(nombreSel, { clickCount: 3 }).catch(() => {});
      await page.type(nombreSel, job.titular_nombre);
      if (ap1Sel && job.titular_apellido1) await page.type(ap1Sel, job.titular_apellido1).catch(() => {});
      if (ap2Sel && job.titular_apellido2) await page.type(ap2Sel, job.titular_apellido2).catch(() => {});
      const clicked = await buscarBtn();
      if (!clicked) throw new Error("boton_buscar_no_encontrado");
    } else {
      throw new Error("selector_no_encontrado:formulario_busqueda");
    }

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