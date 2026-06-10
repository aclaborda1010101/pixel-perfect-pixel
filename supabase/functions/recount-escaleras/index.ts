// recount-escaleras
// Reconteo focalizado de cajas de escalera SIEMPRE sobre la PLANTA 1 (PISO 01)
// del FXCC catastral. Cruza con n_subparcelas_residenciales (DNPRC) y aplica
// MAX(plano_piso1, subparcelas_distintas). Genera building_feedback al cambiar
// segundas_escaleras.

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const PROMPT_PISO1 = `Eres un experto en planos catastrales (FXCC) de Madrid.
Tu única tarea es contar las CAJAS DE ESCALERA (núcleos verticales) en la
PRIMERA PLANTA (PISO 01) del edificio.

REGLAS ESTRICTAS (no las contradigas):
1. El conteo se hace SIEMPRE sobre la planta etiquetada como "PISO 01" / "PLANTA 01" /
   "PLANTA 1ª" / "PRIMERA PLANTA". Es la primera planta encima de la planta baja.
2. NO uses la planta baja ("PB", "PLANTA BAJA", "P. BAJA", "BAJA") para contar.
   En planta baja una caja de escalera se confunde con el portal, el zaguán o un
   pasillo largo; sólo el PISO 01 muestra los huecos de caja con claridad.
3. Si entre las páginas no hay una claramente etiquetada como PISO 01, usa la
   primera planta tipo residencial (la primera con códigos V.A / V.B / V.C…).
4. Una CAJA DE ESCALERA en el plano es un recinto cerrado, normalmente
   rectangular, etiquetado "ESC", "E", "ESC1", "ESC2", o reconocible por su
   geometría (peldaños/aspas/diagonales internas) y por separar dos zonas
   residenciales independientes (escalera A / escalera B).
5. Cuenta cuántas cajas DISTINTAS hay en esa planta. Si hay 2 ó más núcleos
   verticales NO conectados entre sí → n_escaleras_piso01 = 2 (o el número que
   sean) con confianza alta.
6. Si dudas entre 1 y 2: mira si hay 2 grupos de viviendas V.A.* y V.B.*
   separados, y/o si los códigos de localizador interior usan letras de
   escalera distintas. Eso confirma 2 escaleras.

Devuelve EXACTAMENTE este JSON (sin texto fuera):
{
  "pagina_piso01_index": number,              // índice 0-based de la página utilizada
  "pagina_piso01_etiqueta": string,           // ej: "PISO 01", "PLANTA 1ª"
  "n_escaleras_piso01": number,               // entero >=1
  "etiquetas_escaleras": string[],            // ej: ["ESC_A","ESC_B"]
  "posiciones": string[],                     // ej: ["norte junto a fachada","sur junto a patio"]
  "razonamiento": string,                     // 1-3 frases en español
  "confidence": number                        // 0..1
}
`;

async function callGateway(apiKey: string, model: string, imageUrls: string[]): Promise<any> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT_PISO1 },
          ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gateway ${r.status}`);
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(txt); } catch { throw new Error("JSON inválido"); }
}

async function recountOne(sb: any, apiKey: string, building_id: string) {
  const { data: b } = await sb.from("buildings")
    .select("id, direccion, refcatastral, catastro_ref")
    .eq("id", building_id).maybeSingle();
  if (!b) return { building_id, error: "no building" };

  const rc14 = String(b.refcatastral ?? b.catastro_ref ?? "").slice(0, 14);
  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls, plantas_pages_urls")
    .eq("building_id", building_id).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls
    : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (pages.length === 0) return { building_id, direccion: b.direccion, error: "sin FXCC" };

  const { data: prev } = await sb.from("building_analysis")
    .select("n_escaleras_en_piso01, segundas_escaleras, n_escaleras_final")
    .eq("building_id", building_id).maybeSingle();

  const { data: cac } = rc14 ? await sb.from("catastro_authority_cache")
    .select("n_subparcelas_residenciales").eq("refcatastral_14", rc14).maybeSingle() : { data: null };
  let nSub: number | null = cac?.n_subparcelas_residenciales ?? null;

  // Si falta, lo calculamos inline llamando a Catastro DNPRC (mismo método que parse-catastro-subparcelas).
  if ((nSub == null || nSub === 0) && rc14) {
    try {
      const r = await fetch(`https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC?RefCat=${rc14}`, { headers: { Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        const escSet = new Set<string>();
        let nRes = 0;
        const walk = (n: any) => {
          if (!n || typeof n !== "object") return;
          if (Array.isArray(n)) { n.forEach(walk); return; }
          if (n.loint && typeof n.loint === "object") {
            const es = String(n.loint.es ?? "").trim();
            if (es) escSet.add(es);
          }
          const uso = String(n?.dfcons?.lcuso?.cuso ?? n?.debi?.luso ?? n?.luso ?? n?.dest ?? "").toUpperCase();
          if (uso === "V" || uso.startsWith("VIVIENDA") || uso.includes("RESIDENCIAL")) nRes++;
          for (const k of Object.keys(n)) walk(n[k]);
        };
        walk(j);
        nSub = nRes > 0 ? Math.max(escSet.size, 1) : escSet.size;
        await sb.from("catastro_authority_cache")
          .update({ n_subparcelas_residenciales: nSub })
          .eq("refcatastral_14", rc14);
      }
    } catch (e) { console.warn(`DNPRC inline error ${rc14}: ${(e as Error).message}`); }
  }

  let parsed: any = null;
  let modelo = "google/gemini-3.1-pro-preview";
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try { parsed = await callGateway(apiKey, modelo, pages); }
    catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!parsed) {
    modelo = "google/gemini-2.5-pro";
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try { parsed = await callGateway(apiKey, modelo, pages); }
      catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
    }
  }
  if (!parsed) return { building_id, direccion: b.direccion, error: lastErr ?? "VLM sin respuesta" };

  const nVlm = Math.max(1, Math.min(8, Math.round(Number(parsed.n_escaleras_piso01 ?? 1))));
  // MAX(plano, subparcelas) — sólo eleva si subparcelas claramente lo confirma.
  const candidates = [nVlm];
  if (typeof nSub === "number" && nSub >= 1) candidates.push(nSub);
  const nFinal = Math.max(...candidates);
  const fuente = nFinal === nVlm && (nSub == null || nSub <= nVlm)
    ? "plano_piso01"
    : (nSub != null && nSub > nVlm ? "subparcelas_catastro" : "max");

  // Auditoría: n_final = MAX(VLM, DNPRC). Pero NO se escribe segundas_escaleras
  // desde DNPRC porque el A/B mostró 24/47 falsos positivos en gt=1.
  // segundas_escaleras se mantiene desde el VLM (señal con baja recall pero alta precisión).
  const segundas = nVlm >= 2;
  const evidencia = {
    n_vlm_piso01: nVlm,
    n_subparcelas_residenciales: nSub,
    n_final: nFinal,
    fuente,
    pagina_index: parsed.pagina_piso01_index ?? null,
    pagina_etiqueta: parsed.pagina_piso01_etiqueta ?? null,
    etiquetas: parsed.etiquetas_escaleras ?? null,
    posiciones: parsed.posiciones ?? null,
    razonamiento: parsed.razonamiento ?? null,
    confidence: parsed.confidence ?? null,
    modelo,
  };

  await sb.from("building_analysis").upsert({
    building_id,
    n_escaleras_en_piso01: nVlm,
    n_escaleras_final: nFinal,
    n_escaleras_fuente: fuente,
    n_escaleras_evidencia: evidencia,
    segundas_escaleras: segundas,
  }, { onConflict: "building_id" });

  const changed = (prev?.segundas_escaleras ?? null) !== segundas
    || (prev?.n_escaleras_en_piso01 ?? null) !== nVlm
    || (prev?.n_escaleras_final ?? null) !== nFinal;

  if (changed) {
    await sb.from("building_feedback").insert({
      building_id,
      canal: "sistema",
      autor_email: "escaleras-recount@affluxos",
      dimension: "escaleras",
      estado: "abierto",
      texto: `Reconteo de escaleras (regla PLANTA 1): ${prev?.n_escaleras_en_piso01 ?? "—"} → ${nVlm} (plano), subparcelas=${nSub ?? "—"}, final=${nFinal} [${fuente}]. segundas_escaleras: ${prev?.segundas_escaleras ?? "—"} → ${segundas}.`,
      analisis_ia: { antes: prev, despues: evidencia },
    });
  }

  return { building_id, direccion: b.direccion, ...evidencia, segundas_escaleras: segundas, changed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return err("LOVABLE_API_KEY missing", 500);

  const body = await req.json().catch(() => ({}));
  const sb = getServiceClient();
  const asyncMode = body.async === true;

  let ids: string[] = [];
  if (Array.isArray(body.building_ids) && body.building_ids.length) ids = body.building_ids;
  else if (body.building_id) ids = [body.building_id];
  else if (body.all === true || body.qa_ground_truth === true) {
    const q = body.qa_ground_truth
      ? await sb.from("qa_ground_truth").select("building_id").not("building_id", "is", null)
      : await sb.from("buildings").select("id").not("refcatastral", "is", null);
    const rows = q.data ?? [];
    ids = Array.from(new Set(rows.map((r: any) => r.building_id ?? r.id))).filter(Boolean) as string[];
  }
  if (ids.length === 0) return err("building_id, building_ids, all=true o qa_ground_truth=true requerido", 400);

  const run = async () => {
    const results: any[] = [];
    for (const id of ids) {
      try { results.push(await recountOne(sb, apiKey, id)); }
      catch (e) { results.push({ building_id: id, error: (e as Error).message }); }
      await new Promise(r => setTimeout(r, 250));
    }
    console.log("recount-escaleras done", JSON.stringify({ total: results.length, changed: results.filter(r => r.changed).length }));
    return results;
  };

  if (asyncMode) {
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(run());
    return json({ ok: true, async: true, queued: ids.length }, 202);
  }
  const results = await run();
  return json({ ok: true, total: results.length, results });
});