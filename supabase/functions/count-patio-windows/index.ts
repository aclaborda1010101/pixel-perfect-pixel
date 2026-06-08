// count-patio-windows
// Fase 5.5: estima ventanas a patios interiores usando el polígono Catastro
// (interiorRings via WFS-INSPIRE). Sin VLM, sin Street View.
// Confianza máxima: "media" (geometric_perimeter) / "baja" (fallback).

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";
import { fetchParcelGeometry } from "../_shared/parcel_geometry.ts";

// ---------- Geometría ----------
const toRad = (d: number) => (d * Math.PI) / 180;

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Proyecta lon/lat a metros locales (equirect) usando un origen.
function project(ring: [number, number][]): { x: number; y: number }[] {
  const lat0 = ring[0][1];
  const lon0 = ring[0][0];
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(toRad(lat0));
  return ring.map(([lon, lat]) => ({
    x: (lon - lon0) * mPerDegLon,
    y: (lat - lat0) * mPerDegLat,
  }));
}

function shoelaceArea(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  const pts = project(ring);
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    s += pts[i].x * pts[i + 1].y - pts[i + 1].x * pts[i].y;
  }
  return Math.abs(s) / 2;
}

function ringPerimeter(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += haversine(ring[i], ring[i + 1]);
  return s;
}

// Lado corto del rotated minimum bounding box (rotating calipers simplificado).
function minBBoxShortSide(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  const pts = project(ring);
  let best = Infinity;
  // Probar orientaciones cada 5 grados (suficiente para esta fase).
  for (let deg = 0; deg < 180; deg += 5) {
    const θ = toRad(deg);
    const c = Math.cos(θ);
    const s = Math.sin(θ);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) {
      const u = p.x * c + p.y * s;
      const v = -p.x * s + p.y * c;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const shortSide = Math.min(w, h);
    if (shortSide < best) best = shortSide;
  }
  return isFinite(best) ? best : 0;
}

// ---------- Densidad por año de construcción ----------
function densidadPorAno(ano: number | null, override: number | null): number {
  if (override && override > 0) return override;
  if (!ano) return 3.0;
  if (ano < 1940) return 2.5;
  if (ano < 1970) return 3.0;
  if (ano < 2000) return 3.5;
  return 4.0;
}

// ---------- Plantas residenciales ----------
function contarPlantasResidenciales(plantas: any[]): number {
  // Reglas alineadas con Fase 5: BJ + EN + 01..N + BC sobre rasante, excluye CUB/TZA/sótanos.
  // Si no hay plantas detalladas, devolver 0 (la lógica fallback usa inferred_floor_count).
  if (!Array.isArray(plantas)) return 0;
  let n = 0;
  for (const p of plantas) {
    const cod = String(p?.codigo ?? "").toUpperCase();
    if (cod === "BJ" || cod === "EN" || cod === "BC") n++;
    else if (/^\d{2}$/.test(cod)) n++;
  }
  return n;
}

// ---------- Main ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const buildingId: string | undefined = body?.building_id;
    const force: boolean = !!body?.force;
    if (!buildingId) return err("building_id requerido", 400);

    const supabase = getServiceClient();

    // 1) Building
    const { data: building, error: bErr } = await supabase
      .from("buildings")
      .select("id, refcatastral, metadatos")
      .eq("id", buildingId)
      .maybeSingle();
    if (bErr || !building) return err(`Building no encontrado: ${bErr?.message ?? "missing"}`, 404);

    const rc14: string | null = building.refcatastral
      ? String(building.refcatastral).slice(0, 14)
      : null;
    if (!rc14) return err("Edificio sin refcatastral_14", 400);

    // 2) Autoridad Catastro (cache; invoca layer si falta)
    let { data: authority } = await supabase
      .from("catastro_authority_cache")
      .select("*")
      .eq("refcatastral_14", rc14)
      .maybeSingle();

    if (!authority || force) {
      const invokeRes = await supabase.functions.invoke("catastro-authority-layer", {
        body: { building_id: buildingId, force },
      });
      if (invokeRes.error) {
        return err(`catastro-authority-layer falló: ${invokeRes.error.message}`, 502);
      }
      const refreshed = await supabase
        .from("catastro_authority_cache")
        .select("*")
        .eq("refcatastral_14", rc14)
        .maybeSingle();
      authority = refreshed.data;
    }
    if (!authority) return err("No se pudo obtener autoridad Catastro", 502);

    const plantas = (authority.plantas as any[]) ?? [];
    const inferredFloors = (authority.inferred_floor_count as number | null) ?? (authority.numero_plantas as number | null);
    const anoConstruccion = authority.year_built ?? authority.ano_construccion ?? null;
    const superficieParcela = (authority.superficie_parcela_m2 as number | null) ?? null;
    const numViviendas = (authority.viviendas_total as number | null) ?? null;

    let plantasResidenciales = contarPlantasResidenciales(plantas);
    if (plantasResidenciales === 0 && inferredFloors) {
      plantasResidenciales = inferredFloors;
    }
    if (plantasResidenciales === 0) {
      return err("No se pudo determinar plantas residenciales", 422);
    }

    // 3) Polígono con anillos interiores
    const lat = (authority.lat as number | null) ?? null;
    const lon = (authority.lon as number | null) ?? null;
    const geom = await fetchParcelGeometry({
      refcatastral_14: rc14,
      lat,
      lon,
      force,
      sbAdmin: supabase,
    });
    const exterior = geom.exterior_ring.length >= 4 ? geom.exterior_ring : null;
    const interior = geom.interior_rings ?? [];
    const flags: string[] = [...geom.flags];
    const notas: string[] = [];
    notas.push(`Geometría: source=${geom.source}, confianza=${geom.confidence}${geom.cached ? " (cache)" : ""}.`);

    if (!exterior || geom.source === "fallback") {
      // Fallback duro: sin polígono no podemos estimar geométricamente.
      const fallback = {
        patios_detectados: [],
        estimacion_total: 0,
        estimacion_rango: { min: 0, max: 0 },
        metodo: "fallback_estimado",
        confianza: "baja",
        flags: [...flags, "sin_poligono_real"],
        notas: `No se obtuvo polígono real (source=${geom.source}). Estimación no posible.`,
      };
      const { data: inserted } = await supabase
        .from("patio_window_counts")
        .insert({
          building_id: buildingId,
          refcatastral_14: rc14,
          patios_detectados: fallback.patios_detectados,
          estimacion_total: 0,
          estimacion_rango: fallback.estimacion_rango,
          metodo: fallback.metodo,
          confianza: fallback.confianza,
          flags: fallback.flags,
          notas: fallback.notas,
          plantas_residenciales: plantasResidenciales,
          numero_viviendas: numViviendas,
        })
        .select("id")
        .single();
      return json({ ...fallback, audit_id: inserted?.id });
    }

    // 4) Clasificar anillos interiores
    type PatioDetectado = {
      area_m2: number;
      perimetro_m: number;
      dimension_menor_m: number;
      tipo: "patio" | "patinillo";
    };
    const patios: PatioDetectado[] = interior.map((ring) => {
      const area_m2 = Math.round(shoelaceArea(ring) * 10) / 10;
      const perimetro_m = Math.round(ringPerimeter(ring) * 10) / 10;
      const dimension_menor_m = Math.round(minBBoxShortSide(ring) * 10) / 10;
      const tipo: "patio" | "patinillo" =
        area_m2 >= 9 && dimension_menor_m >= 3 ? "patio" : "patinillo";
      return { area_m2, perimetro_m, dimension_menor_m, tipo };
    });

    const patiosReales = patios.filter((p) => p.tipo === "patio");

    // 5) Densidad calibrable
    const overrideRaw = Deno.env.get("DENSIDAD_PATIO_M");
    const overrideDensidad = overrideRaw ? Number(overrideRaw) : null;
    const densidad = densidadPorAno(anoConstruccion, overrideDensidad);

    // 6) Estimación
    let estimacionTotal = 0;
    let metodo: "geometric_perimeter" | "plantas_pdf" = "geometric_perimeter";
    let confianza: "media" | "baja" = "baja";

    if (patiosReales.length === 0) {
      flags.push("sin_patios_detectados");
      if (interior.length === 0) {
        notas.push("Polígono sin anillos interiores: o no hay patios o no figuran en la fuente.");
        flags.push("patio_estimado_sin_geometria");
      } else {
        notas.push("No se detectaron patios reales (área ≥ 9 m² y lado menor ≥ 3 m).");
      }
    } else {
      const perimetroTotalPatios = patiosReales.reduce((s, p) => s + p.perimetro_m, 0);
      const ventanasPorPlanta = Math.round(perimetroTotalPatios / densidad);
      estimacionTotal = ventanasPorPlanta * plantasResidenciales;
      confianza = "media";
      notas.push(
        `Estimación geométrica (${geom.source}): ${patiosReales.length} patio(s) reales, perímetro total ${perimetroTotalPatios.toFixed(1)} m, densidad ${densidad} m/hueco × ${plantasResidenciales} plantas residenciales.`,
      );
    }

    const min = Math.round(estimacionTotal * 0.85);
    const max = Math.round(estimacionTotal * 1.15);

    // 7) Validaciones
    if (numViviendas && numViviendas > 0 && estimacionTotal > 0) {
      const ratio = estimacionTotal / numViviendas;
      if (ratio < 1.5 || ratio > 5) flags.push("huecos_por_vivienda_inusual");
    }
    if (superficieParcela && superficieParcela > 0) {
      const areaPatios = patios.reduce((s, p) => s + p.area_m2, 0);
      if (areaPatios > 0.6 * superficieParcela) {
        flags.push("area_patios_inusualmente_grande");
      }
    }
    // Patio mancomunado: heurística básica, área menor que un patinillo pero >9 m² o
    // anillo interior tocando perímetro exterior. Por ahora solo flag informativa si
    // hay más de 3 patios reales (raro en parcela única).
    if (patiosReales.length > 3) flags.push("patio_posiblemente_mancomunado");

    // 8) Persistir
    const { data: inserted, error: insErr } = await supabase
      .from("patio_window_counts")
      .insert({
        building_id: buildingId,
        refcatastral_14: rc14,
        patios_detectados: patios,
        estimacion_total: estimacionTotal,
        estimacion_rango: { min, max },
        metodo,
        confianza,
        flags,
        notas: notas.join(" "),
        densidad_patio_m: densidad,
        plantas_residenciales: plantasResidenciales,
        numero_viviendas: numViviendas,
      })
      .select("id")
      .single();
    if (insErr) return err(`No se pudo persistir: ${insErr.message}`, 500);

    return json({
      patios_detectados: patios,
      estimacion_total: estimacionTotal,
      estimacion_rango: { min, max },
      metodo,
      confianza,
      flags,
      notas: notas.join(" "),
      densidad_patio_m: densidad,
      plantas_residenciales: plantasResidenciales,
      numero_viviendas: numViviendas,
      audit_id: inserted?.id,
    });
  } catch (e) {
    return err(`Error interno: ${(e as Error).message}`, 500);
  }
});
