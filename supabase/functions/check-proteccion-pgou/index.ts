// check-proteccion-pgou
// F1-D: cruza un edificio con el Catálogo Geográfico de Edificios Protegidos
// del Ayuntamiento de Madrid (PGOU) consultando el MapServer ArcGIS.
// Estrategia en cascada (registra cada intento en building_analysis.protegido_raw):
//   1) Polígono (exterior_ring de parcel_geometry_cache) → esriGeometryPolygon
//   2) Fallback RC14: where REFCAT LIKE '<rc14>%'
//   3) Fallback fuzzy por dirección contra madrid_edificios_protegidos (similarity)
// Si HIT → protegido_historicamente=true, proteccion_source='pgou_poligono'|'pgou_rc14'|'pgou_fuzzy'.
// MISS → no sobreescribe.
// Body: { building_id } | { building_ids } | { all_pending: true }

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const ARCGIS_LAYER =
  "https://sigma.madrid.es/hosted/rest/services/DESARROLLO_URBANO_ACTUALIZADO/EDIFICIOS_PROTEGIDOS/MapServer/5/query";

type PgouHit = {
  n_catalogo: string | null;
  nombre: string | null;
  proteccion_actual: string | null;
  proteccion_97: string | null;
};

function parseHit(j: any): PgouHit | null {
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

async function queryByPolygon(ring: [number, number][]): Promise<{ hit: PgouHit | null; raw: any }> {
  const rings = [ring.map(([lon, lat]) => [lon, lat])];
  const geometry = JSON.stringify({ rings, spatialReference: { wkid: 4326 } });
  const params = new URLSearchParams({
    geometry,
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "N_CATALOGO,NOMBRE,PROTECCION_ACTUAL,PROTECCION_97",
    returnGeometry: "false",
    f: "json",
  });
  const r = await fetch(ARCGIS_LAYER, { method: "POST", body: params });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ArcGIS POLY ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return { hit: parseHit(j), raw: { status: r.status, count: j?.features?.length ?? 0, sample: j?.features?.[0] ?? null } };
}

async function queryByRefcat(rc14: string): Promise<{ hit: PgouHit | null; raw: any }> {
  const url = `${ARCGIS_LAYER}?where=${encodeURIComponent(`REFCAT LIKE '${rc14}%'`)}` +
    `&outFields=N_CATALOGO,NOMBRE,PROTECCION_ACTUAL,PROTECCION_97,REFCAT&returnGeometry=false&f=json`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ArcGIS RC ${r.status}`);
  return { hit: parseHit(j), raw: { status: r.status, count: j?.features?.length ?? 0, sample: j?.features?.[0] ?? null } };
}

async function queryByFuzzyDireccion(supabase: any, direccion: string): Promise<{ hit: PgouHit | null; raw: any }> {
  const dirNorm = (direccion || "").toUpperCase().trim();
  if (!dirNorm) return { hit: null, raw: { reason: "no_dir" } };
  // similaridad pg_trgm
  const { data, error } = await supabase.rpc("pgou_fuzzy_match" as any, { p_dir: dirNorm }).catch(() => ({ data: null, error: "no_rpc" }));
  if (data && data.length > 0) {
    const row = data[0];
    return {
      hit: { n_catalogo: row.refcat ?? null, nombre: null, proteccion_actual: row.nivel_proteccion ?? null, proteccion_97: null },
      raw: { source: "rpc", row },
    };
  }
  // fallback: select directo con similarity()
  const { data: rows } = await supabase
    .from("madrid_edificios_protegidos")
    .select("refcat, direccion, direccion_norm, nivel_proteccion")
    .ilike("direccion_norm", `%${dirNorm.split(" ").slice(0, 3).join(" ")}%`)
    .limit(3);
  if (rows && rows.length > 0) {
    const row = rows[0];
    return {
      hit: { n_catalogo: row.refcat ?? null, nombre: null, proteccion_actual: row.nivel_proteccion ?? null, proteccion_97: null },
      raw: { source: "ilike", row, candidates: rows.length },
    };
  }
  return { hit: null, raw: { source: "fuzzy", count: 0 } };
}

async function processOne(supabase: any, buildingId: string) {
  const { data: b, error: bErr } = await supabase
    .from("buildings")
    .select("id, direccion, refcatastral")
    .eq("id", buildingId)
    .maybeSingle();
  if (bErr || !b) return { building_id: buildingId, error: "building no encontrado" };

  const rc14 = b.refcatastral ? String(b.refcatastral).slice(0, 14) : null;
  const intentos: any[] = [];
  let hit: PgouHit | null = null;
  let source: string | null = null;

  // 1) Polígono
  let exteriorRing: [number, number][] | null = null;
  if (rc14) {
    const { data: pgc } = await supabase
      .from("parcel_geometry_cache").select("exterior_ring, centroid")
      .eq("refcatastral_14", rc14).maybeSingle();
    const er = pgc?.exterior_ring as [number, number][] | null;
    if (er && Array.isArray(er) && er.length >= 4) exteriorRing = er;
  }
  if (exteriorRing) {
    try {
      const r = await queryByPolygon(exteriorRing);
      intentos.push({ intento: "poligono", hit: !!r.hit, raw: r.raw, ts: new Date().toISOString() });
      if (r.hit) { hit = r.hit; source = "pgou_poligono"; }
    } catch (e) {
      intentos.push({ intento: "poligono", error: (e as Error).message, ts: new Date().toISOString() });
    }
  } else {
    intentos.push({ intento: "poligono", skipped: "sin_exterior_ring", ts: new Date().toISOString() });
  }

  // 2) Fallback RC14
  if (!hit && rc14) {
    try {
      const r = await queryByRefcat(rc14);
      intentos.push({ intento: "rc14", hit: !!r.hit, raw: r.raw, ts: new Date().toISOString() });
      if (r.hit) { hit = r.hit; source = "pgou_rc14"; }
    } catch (e) {
      intentos.push({ intento: "rc14", error: (e as Error).message, ts: new Date().toISOString() });
    }
  }

  // 3) Fallback fuzzy dirección
  if (!hit) {
    try {
      const r = await queryByFuzzyDireccion(supabase, b.direccion);
      intentos.push({ intento: "fuzzy_dir", hit: !!r.hit, raw: r.raw, ts: new Date().toISOString() });
      if (r.hit) { hit = r.hit; source = "pgou_fuzzy"; }
    } catch (e) {
      intentos.push({ intento: "fuzzy_dir", error: (e as Error).message, ts: new Date().toISOString() });
    }
  }

  if (rc14) {
    await supabase.from("madrid_edificios_protegidos").upsert({
      refcat: rc14, refcat_norm: rc14,
      direccion: b.direccion, direccion_norm: (b.direccion ?? "").toUpperCase(),
      nivel_proteccion: hit?.proteccion_actual ?? null,
      fuente: source ?? "pgou_check",
      raw: { building_id: buildingId, hit, intentos, checked_at: new Date().toISOString() },
    }, { onConflict: "refcat" });
  }

  // 4) Read current analysis
  const { data: ba } = await supabase
    .from("building_analysis")
    .select("building_id, protegido_historicamente, proteccion_source, protegido_raw")
    .eq("building_id", buildingId)
    .maybeSingle();

  const prevRaw = (ba?.protegido_raw as any[]) ?? [];
  const newRaw = [...prevRaw, { run_at: new Date().toISOString(), intentos, final_hit: hit, final_source: source }];

  let updated = false;
  let note = "";
  if (hit) {
    if (ba) {
      await supabase.from("building_analysis")
        .update({ protegido_historicamente: true, proteccion_source: source, protegido_raw: newRaw })
        .eq("building_id", buildingId);
    } else {
      await supabase.from("building_analysis").insert({
        building_id: buildingId, protegido_historicamente: true, proteccion_source: source, protegido_raw: newRaw,
      });
    }
    updated = true;
    note = `HIT ${source}: N_CAT=${hit.n_catalogo} nivel=${hit.proteccion_actual}`;
  } else {
    if (ba) {
      await supabase.from("building_analysis").update({ protegido_raw: newRaw }).eq("building_id", buildingId);
    } else {
      await supabase.from("building_analysis").insert({ building_id: buildingId, protegido_raw: newRaw });
    }
    note = "MISS pgou (no overwrite)";
  }

  return {
    building_id: buildingId,
    direccion: b.direccion,
    rc14,
    pgou_hit: !!hit,
    source,
    intentos: intentos.map((i) => ({ intento: i.intento, hit: i.hit ?? false, skipped: i.skipped, error: i.error })),
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
    const supabase = getServiceClient();
    let ids: string[] = body?.building_ids ?? (body?.building_id ? [body.building_id] : []);
    if (ids.length === 0 && body?.all_pending) {
      const { data: rows } = await supabase.from("buildings")
        .select("id").not("refcatastral", "is", null).limit(200);
      ids = (rows || []).map((r: any) => r.id);
    }
    if (ids.length === 0) return err("building_id, building_ids o all_pending requerido", 400);

    const results: any[] = [];
    for (const id of ids) {
      try { results.push(await processOne(supabase, id)); }
      catch (e) { results.push({ building_id: id, error: (e as Error).message }); }
      await new Promise((r) => setTimeout(r, 100));
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