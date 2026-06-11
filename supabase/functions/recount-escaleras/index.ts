// recount-escaleras (v7.2-gemini P01-first promovido)
// Estrategia: VLM lee PB y P01; n_final = n_cajas_p01 (PB sólo tie-breaker
// si P01 no es legible). Modelo principal google/gemini-2.5-pro
// (precision 100% en ctrl_10x10_v1). Si el VLM no puede decidir →
// needs_review: NO se sobrescribe segundas_escaleras (no inventar; un FP
// dispararía cambio de uso a hospedaje). Cruza con n_subparcelas_residenciales
// (DNPRC) sólo para elevar n_escaleras_final, NUNCA para tocar segundas_*.

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const PROMPT_V72 = `Eres un experto en planos catastrales (FXCC) de Madrid.
Tu objetivo es contar las CAJAS DE ESCALERA (núcleos verticales) de un
edificio residencial. Prioriza SIEMPRE la PLANTA 1 sobre la PLANTA BAJA.

1. PLANTA 1 ("PISO 01", "PLANTA 01", "PLANTA 1ª", "PRIMERA").
   - Una "caja de escalera" es un recinto cerrado con peldaños/diagonales
     que separa grupos de viviendas (V.A.*, V.B.*, ...).
   - Cuenta las cajas DISTINTAS. Si hay 2 grupos de viviendas (V.A y V.B)
     servidos por núcleos independientes, son 2 cajas.
   - Llama "n_cajas_p01" al número de cajas que veas en P01.
   - Marca "p01_legible" = true si la planta es clara, false si está
     cortada/borrosa/ausente.

2. PLANTA BAJA ("PB", "PLANTA BAJA", "P. BAJA", "BAJA") — SECUNDARIO.
   - Cuenta SOLO portales residenciales (puertas de calle a viviendas;
     ignora locales, garaje, trasteros, salidas de emergencia).
   - Llama "n_portales_pb" al número de portales residenciales.
   - Marca "pb_legible" = true/false.

REGLA DE DECISIÓN (estricta):
- Si p01_legible y n_cajas_p01 es un entero >=1 → n_final = n_cajas_p01.
- Si NO p01_legible pero pb_legible y n_portales_pb es entero >=1
  → n_final = n_portales_pb (PB como tie-breaker).
- Si ninguna planta es legible → n_final = null, needs_review = true.
- Prohibido inventar. Un falso positivo de "2 escaleras" dispara cambio de
  uso a hospedaje en producción: si no estás seguro, devuelve null.

Devuelve EXACTAMENTE este JSON (sin texto fuera):
{
  "pagina_pb_etiqueta": string | null,
  "pagina_p01_etiqueta": string | null,
  "p01_legible": boolean,
  "pb_legible": boolean,
  "n_portales_pb": number | null,
  "n_cajas_p01": number | null,
  "n_final": number | null,
  "fuente_n_final": "p01" | "pb" | null,
  "needs_review": boolean,
  "confidence": number,
  "razonamiento": string
}`;

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
  let modelo = "google/gemini-2.5-pro";
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try { parsed = await callGateway(apiKey, modelo, pages); }
    catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!parsed) {
    modelo = "google/gemini-3.1-pro-preview";
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try { parsed = await callGateway(apiKey, modelo, pages); }
      catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
    }
  }
  if (!parsed) return { building_id, direccion: b.direccion, error: lastErr ?? "VLM sin respuesta" };

  const nP = parsed.n_portales_pb == null ? null : Math.round(Number(parsed.n_portales_pb));
  const nC = parsed.n_cajas_p01 == null ? null : Math.round(Number(parsed.n_cajas_p01));
  const p01Leg = Boolean(parsed.p01_legible);
  const pbLeg = Boolean(parsed.pb_legible);

  // Regla P01-first server-side (no nos fiamos sólo del VLM).
  let nVlm: number | null = null;
  let fuenteVlm: "p01" | "pb" | null = null;
  if (p01Leg && nC != null && Number.isFinite(nC) && nC >= 1) {
    nVlm = nC; fuenteVlm = "p01";
  } else if (!p01Leg && pbLeg && nP != null && Number.isFinite(nP) && nP >= 1) {
    nVlm = nP; fuenteVlm = "pb";
  } else if (parsed.n_final != null && Number.isFinite(Number(parsed.n_final))) {
    nVlm = Math.round(Number(parsed.n_final));
    fuenteVlm = (parsed.fuente_n_final === "pb" ? "pb" : "p01");
  }
  nVlm = nVlm == null ? null : Math.max(1, Math.min(8, nVlm));
  const needsReview = nVlm == null;

  // n_final = MAX(VLM, DNPRC) sólo cuando tenemos VLM. DNPRC NUNCA toca
  // segundas_escaleras (24/47 FP en gt=1 según A/B previo).
  const nFinal: number | null = nVlm == null
    ? (typeof nSub === "number" && nSub >= 1 ? nSub : null)
    : Math.max(nVlm, typeof nSub === "number" ? nSub : nVlm);
  const fuente = needsReview
    ? (typeof nSub === "number" && nSub >= 1 ? "subparcelas_catastro_only" : "needs_review")
    : (nFinal === nVlm && (nSub == null || nSub <= (nVlm ?? 0))
        ? `vlm_${fuenteVlm}`
        : (nSub != null && nSub > (nVlm ?? 0) ? "subparcelas_catastro" : "max"));

  // segundas_escaleras: SÓLO se escribe si el VLM tiene veredicto.
  // Si needs_review, mantenemos el valor previo (no inventar).
  const segundasNuevo: boolean | null = needsReview ? null : (nVlm! >= 2);
  const evidencia = {
    version: "v7.2-gemini",
    n_portales_pb: nP,
    n_cajas_p01: nC,
    p01_legible: p01Leg,
    pb_legible: pbLeg,
    fuente_vlm: fuenteVlm,
    n_vlm_piso01: nVlm,
    n_subparcelas_residenciales: nSub,
    n_final: nFinal,
    fuente,
    needs_review: needsReview,
    pagina_pb_etiqueta: parsed.pagina_pb_etiqueta ?? null,
    pagina_p01_etiqueta: parsed.pagina_p01_etiqueta ?? null,
    razonamiento: parsed.razonamiento ?? null,
    confidence: parsed.confidence ?? null,
    modelo,
  };

  const upsertRow: any = {
    building_id,
    n_escaleras_en_piso01: nVlm,
    n_escaleras_final: nFinal,
    n_escaleras_fuente: fuente,
    n_escaleras_evidencia: evidencia,
  };
  if (!needsReview) upsertRow.segundas_escaleras = segundasNuevo;

  await sb.from("building_analysis").upsert(upsertRow, { onConflict: "building_id" });

  const segundasFinal = needsReview ? (prev?.segundas_escaleras ?? null) : segundasNuevo;
  const changed = !needsReview && (
    (prev?.segundas_escaleras ?? null) !== segundasNuevo
    || (prev?.n_escaleras_en_piso01 ?? null) !== nVlm
    || (prev?.n_escaleras_final ?? null) !== nFinal
  );

  if (changed) {
    await sb.from("building_feedback").insert({
      building_id,
      canal: "sistema",
      autor_email: "escaleras-recount@affluxos",
      dimension: "escaleras",
      estado: "abierto",
      texto: `Reconteo escaleras v7.2-gemini (P01-first): VLM ${nVlm} [${fuenteVlm}], subparcelas=${nSub ?? "—"}, final=${nFinal} [${fuente}]. segundas_escaleras: ${prev?.segundas_escaleras ?? "—"} → ${segundasNuevo}.`,
      analisis_ia: { antes: prev, despues: evidencia },
    });
  }

  return { building_id, direccion: b.direccion, ...evidencia, segundas_escaleras: segundasFinal, changed, needs_review: needsReview };
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