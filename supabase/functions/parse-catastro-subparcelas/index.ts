// parse-catastro-subparcelas
// F1-D Paso 4 — extrae nº de subparcelas residenciales del XML DNPRC del Catastro
// para alimentar el GREATEST de escaleras en compute_cluster_score.
// Body: { building_id } | { building_ids } | { all_pending: true }

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const DNPRC_URL = "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC";

async function fetchSubparcelas(rc14: string): Promise<{ n: number; raw: any }> {
  // El servicio JSON acepta RC de 14 dígitos
  const url = `${DNPRC_URL}?RefCat=${rc14}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`DNPRC ${r.status}`);
  const j = await r.json();

  // Estructura: { consulta_dnprcResult: { bico:{...}, lrcdnp:{ rcdnp:[{...}] }, ... } }
  const root = j?.consulta_dnprcResult ?? j?.Consulta_DNPRC ?? j;
  // Lista de subparcelas urbanas: vienen como ldnp/rcdnp en finca multiplica; cada "rc" distinto =
  // un cargo o subparcela. Para residencial filtramos por destino V (VIVIENDA).
  const candidates: any[] = [];
  const lrcdnp = root?.lrcdnp?.rcdnp ?? root?.bico?.lcons?.cons ?? [];
  const arr = Array.isArray(lrcdnp) ? lrcdnp : [lrcdnp];
  for (const it of arr) {
    if (!it) continue;
    candidates.push(it);
  }
  // Heurística: contar entradas con uso/destino residencial
  let nRes = 0;
  const seen = new Set<string>();
  for (const c of candidates) {
    const uso = String(c?.dfcons?.lcuso?.cuso ?? c?.debi?.luso ?? c?.dest ?? "").toUpperCase();
    const isRes = uso === "V" || uso.includes("VIVIENDA") || uso.includes("RESIDENCIAL");
    if (!isRes) continue;
    const escalera = c?.loint?.es ?? c?.dt?.locs?.lous?.lourb?.loint?.es ?? c?.es ?? "";
    const key = String(escalera || c?.loint?.pt || Math.random());
    if (seen.has(key)) continue;
    seen.add(key);
    nRes++;
  }
  // Si todo lo anterior falla, fallback: contar escaleras distintas en localizaciones
  if (nRes === 0) {
    const lcons = root?.bico?.lcons?.cons ?? [];
    const arr2 = Array.isArray(lcons) ? lcons : [lcons];
    const esc = new Set<string>();
    for (const c of arr2) {
      const escalera = c?.loint?.es ?? "";
      if (escalera) esc.add(String(escalera));
    }
    if (esc.size > 0) nRes = esc.size;
  }
  return { n: nRes, raw: { candidates_n: candidates.length, sample: candidates[0] ?? null } };
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
    return { building_id: buildingId, direccion: b.direccion, rc14, n_subparcelas_residenciales: n, sample_uso: raw?.sample?.dfcons?.lcuso?.cuso ?? null };
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