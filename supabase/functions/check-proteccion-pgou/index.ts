// check-proteccion-pgou
// Frente 3: cruza un edificio con el Catálogo Geográfico de Edificios Protegidos
// del Ayuntamiento de Madrid (PGOU) consultando el MapServer ArcGIS por punto.
// - Usa centroide del parcel_geometry_cache (preferente) o lat/lon de catastro_authority_cache.
// - Si HIT → guarda en madrid_edificios_protegidos y marca
//   building_analysis.protegido_historicamente = true (proteccion_source='pgou_catalogo').
// - Si MISS → no sobreescribe lo que la VLM haya dicho (per plan).
//
// Body: { building_id: string } o { building_ids: string[] }

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const ARCGIS_LAYER =
  "https://sigma.madrid.es/hosted/rest/services/DESARROLLO_URBANO_ACTUALIZADO/EDIFICIOS_PROTEGIDOS/MapServer/5/query";

type PgouHit = {
  n_catalogo: string | null;
  nombre: string | null;
  proteccion_actual: string | null;
  proteccion_97: string | null;
};

async function queryPgou(lon: number, lat: number): Promise<PgouHit | null> {
  const url = `${ARCGIS_LAYER}?geometry=${lon},${lat}` +
    `&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=N_CATALOGO,NOMBRE,PROTECCION_ACTUAL,PROTECCION_97&returnGeometry=false&f=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ArcGIS PGOU ${r.status}`);
  const j = await r.json();
  const f = j?.features?.[0];
  if (!f) return null;
  const a = f.attributes ?? {};
  return {
    n_catalogo: a.N_CATALOGO ?? null,
    nombre: a.NOMBRE ?? null,
    proteccion_actual: a.PROTECCION_ACTUAL ?? null,
    proteccion_97: a.PROTECCION_97 ?? null,
  };
}

async function processOne(supabase: any, buildingId: string) {
  const { data: b, error: bErr } = await supabase
    .from("buildings")
    .select("id, direccion, refcatastral")
    .eq("id", buildingId)
    .maybeSingle();
  if (bErr || !b) return { building_id: buildingId, error: "building no encontrado" };

  const rc14 = b.refcatastral ? String(b.refcatastral).slice(0, 14) : null;

  // 1) Punto: centroide parcela > authority lat/lon
  let lat: number | null = null;
  let lon: number | null = null;
  let pt_source = "none";

  if (rc14) {
    const { data: pgc } = await supabase
      .from("parcel_geometry_cache")
      .select("centroid")
      .eq("refcatastral_14", rc14)
      .maybeSingle();
    const c = pgc?.centroid as { lat?: number; lon?: number } | null;
    if (c?.lat && c?.lon) { lat = c.lat; lon = c.lon; pt_source = "parcel_centroid"; }
  }
  if (lat == null && rc14) {
    const { data: ac } = await supabase
      .from("catastro_authority_cache")
      .select("lat, lon")
      .eq("refcatastral_14", rc14)
      .maybeSingle();
    if (ac?.lat && ac?.lon) { lat = ac.lat; lon = ac.lon; pt_source = "authority"; }
  }
  if (lat == null || lon == null) {
    return { building_id: buildingId, direccion: b.direccion, error: "sin coordenadas" };
  }

  // 2) Query PGOU
  let hit: PgouHit | null = null;
  try {
    hit = await queryPgou(lon, lat);
  } catch (e) {
    return { building_id: buildingId, direccion: b.direccion, error: (e as Error).message };
  }

  // 3) Cache row
  await supabase.from("madrid_edificios_protegidos").upsert({
    refcat: rc14,
    refcat_norm: rc14,
    direccion: b.direccion,
    direccion_norm: (b.direccion ?? "").toUpperCase(),
    nivel_proteccion: hit?.proteccion_actual ?? null,
    fuente: "pgou_catalogo",
    raw: {
      building_id: buildingId,
      pt_source,
      lat, lon,
      hit: hit ?? null,
      checked_at: new Date().toISOString(),
    },
  }, { onConflict: "refcat" });

  // 4) Read current analysis
  const { data: ba } = await supabase
    .from("building_analysis")
    .select("building_id, protegido_historicamente, proteccion_source")
    .eq("building_id", buildingId)
    .maybeSingle();

  let updated = false;
  let note = "";

  if (hit) {
    // Catalog HIT → forzar protegido + source.
    if (ba) {
      await supabase.from("building_analysis")
        .update({ protegido_historicamente: true, proteccion_source: "pgou_catalogo" })
        .eq("building_id", buildingId);
    } else {
      await supabase.from("building_analysis").insert({
        building_id: buildingId,
        protegido_historicamente: true,
        proteccion_source: "pgou_catalogo",
      });
    }
    updated = true;
    note = `HIT pgou: N_CAT=${hit.n_catalogo} nivel=${hit.proteccion_actual}`;
  } else {
    // MISS → no sobreescribir. Solo registrar.
    if (ba?.protegido_historicamente === true && !ba?.proteccion_source) {
      // Conservar VLM, dejar hint en source
      await supabase.from("building_analysis")
        .update({ proteccion_source: "vlm_pendiente_revision" })
        .eq("building_id", buildingId);
    }
    note = "MISS pgou (no overwrite)";
  }

  return {
    building_id: buildingId,
    direccion: b.direccion,
    rc14,
    pt_source,
    pgou_hit: !!hit,
    n_catalogo: hit?.n_catalogo ?? null,
    nivel_proteccion: hit?.proteccion_actual ?? null,
    protegido_antes: ba?.protegido_historicamente ?? null,
    proteccion_source_antes: ba?.proteccion_source ?? null,
    updated,
    note,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = body?.building_ids
      ?? (body?.building_id ? [body.building_id] : []);
    if (ids.length === 0) return err("building_id o building_ids requerido", 400);

    const supabase = getServiceClient();
    const results: any[] = [];
    for (const id of ids) {
      try { results.push(await processOne(supabase, id)); }
      catch (e) { results.push({ building_id: id, error: (e as Error).message }); }
      await new Promise((r) => setTimeout(r, 120));
    }
    return json({
      total: results.length,
      hits: results.filter((r) => r.pgou_hit).length,
      updated: results.filter((r) => r.updated).length,
      results,
    });
  } catch (e) {
    return err(`Error: ${(e as Error).message}`, 500);
  }
});