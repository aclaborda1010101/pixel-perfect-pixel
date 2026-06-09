// parse-catastro-subparcelas
// F1-D Paso 4 — extrae nº de subparcelas residenciales del XML DNPRC del Catastro
// para alimentar el GREATEST de escaleras en compute_cluster_score.
// Body: { building_id } | { building_ids } | { all_pending: true }

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const DNPRC_URL = "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC";

async function fetchSubparcelas(rc14: string): Promise<{ n: number; raw: any }> {
  // RC de 14 dígitos
  const url = `${DNPRC_URL}?RefCat=${rc14}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`DNPRC ${r.status}`);
  const j = await r.json();

  // Detectar todas las escaleras distintas mencionadas en cualquier loint.es del payload
  const escaleras = new Set<string>();
  let nResUnidades = 0;
  function walk(node: any) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    // Detectar localizador interior
    if (node.loint && typeof node.loint === "object") {
      const es = String(node.loint.es ?? "").trim();
      if (es) escaleras.add(es);
    }
    // Detectar uso residencial
    const uso = String(
      node?.dfcons?.lcuso?.cuso ?? node?.debi?.luso ?? node?.luso ?? node?.dest ?? "",
    ).toUpperCase();
    if (uso === "V" || uso.startsWith("VIVIENDA") || uso.includes("RESIDENCIAL")) {
      nResUnidades++;
    }
    for (const k of Object.keys(node)) walk((node as any)[k]);
  }
  walk(j);

  // n = nº de escaleras distintas si hay >=1 unidad residencial; si no, 0
  const n = nResUnidades > 0 ? Math.max(escaleras.size, 1) : escaleras.size;
  return { n, raw: { escaleras: Array.from(escaleras), n_res_unidades: nResUnidades, status: r.status } };
}

async function processOne(supabase: any, buildingId: string) {
  const { data: b } = await supabase.from("buildings").select("id, direccion, refcatastral").eq("id", buildingId).maybeSingle();
  if (!b) return { building_id: buildingId, error: "no building" };
  const rc14 = b.refcatastral ? String(b.refcatastral).slice(0, 14) : null;
  if (!rc14) return { building_id: buildingId, error: "sin rc14" };

  try {
    const { n, raw } = await fetchSubparcelas(rc14);
    await supabase.from("catastro_authority_cache")
      .update({ n_subparcelas_residenciales: n })
      .eq("refcatastral_14", rc14);
    return { building_id: buildingId, direccion: b.direccion, rc14, n_subparcelas_residenciales: n, escaleras: raw.escaleras, n_res_unidades: raw.n_res_unidades };
  } catch (e) {
    return { building_id: buildingId, direccion: b.direccion, rc14, error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = getServiceClient();
    let ids: string[] = body?.building_ids ?? (body?.building_id ? [body.building_id] : []);
    if (ids.length === 0 && body?.all_pending) {
      const { data: rows } = await supabase.from("buildings")
        .select("id").not("refcatastral", "is", null).limit(100);
      ids = (rows || []).map((r: any) => r.id);
    }
    if (ids.length === 0) return err("building_id, building_ids o all_pending requerido", 400);

    const results: any[] = [];
    for (const id of ids) {
      try { results.push(await processOne(supabase, id)); }
      catch (e) { results.push({ building_id: id, error: (e as Error).message }); }
      await new Promise((r) => setTimeout(r, 250)); // catastro rate limit
    }
    return json({ total: results.length, results });
  } catch (e) {
    return err((e as Error).message, 500);
  }
});