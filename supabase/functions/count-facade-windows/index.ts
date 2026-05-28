// count-facade-windows
// Fase 5: cuenta ventanas de fachada con rejilla anclada a Catastro.
// El VLM solo identifica ejes verticales; la fórmula calcula el total.
//   total = ejes × plantas_tipo + ventanas_planta_baja + ventanas_entresuelo
// Validado contra Díaz Porlier 47 → 47 ventanas (7 ejes × 5 + 6 + 6).

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const TTL_CAPTURES_MS = 90 * 24 * 60 * 60 * 1000;
const SV_SIZE = "640x640";
const SV_FOV = 110;
const BUCKET = "street-view-captures";

type Planta = { codigo: string; codigo_raw: string; computa_alturas: boolean };

// ---------- Geometría ----------
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function haversine(a: [number, number], b: [number, number]): number {
  // [lon, lat]
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a: [number, number], b: [number, number]): number {
  // [lon, lat] → degrees 0..360 (north=0, clockwise)
  const φ1 = toRad(a[1]), φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function offsetMeters(lat: number, lon: number, dx_m: number, dy_m: number): { lat: number; lon: number } {
  // dx east, dy north
  const dLat = dy_m / 111320;
  const dLon = dx_m / (111320 * Math.cos(toRad(lat)));
  return { lat: lat + dLat, lon: lon + dLon };
}

function offsetAlongBearing(lat: number, lon: number, dist_m: number, bearing_deg: number) {
  const dx = dist_m * Math.sin(toRad(bearing_deg));
  const dy = dist_m * Math.cos(toRad(bearing_deg));
  return offsetMeters(lat, lon, dx, dy);
}

function angularDiff(a: number, b: number): number {
  // ángulo entre 0 y 90 (sin tener en cuenta dirección)
  let d = Math.abs(((a - b + 540) % 360) - 180);
  if (d > 90) d = 180 - d;
  return d;
}

// ---------- Catastro WMS-INSPIRE (polígono de parcela) ----------
async function fetchParcelPolygon(rc14: string): Promise<[number, number][] | null> {
  // WFS GetFeature en GeoJSON. nationalCadastralReference usa los 14 chars del rc.
  const filter =
    `<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc"><ogc:PropertyIsEqualTo><ogc:PropertyName>cp:nationalCadastralReference</ogc:PropertyName><ogc:Literal>${rc14}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>`;
  const url = `https://ovc.catastro.meh.es/INSPIRE/wfsParcel.aspx?service=WFS&version=2.0.0&request=GetFeature&typeNames=cp:CadastralParcel&srsName=EPSG:4326&outputFormat=application/json&Filter=${encodeURIComponent(filter)}`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    const j = await r.json();
    const f = j?.features?.[0];
    const geom = f?.geometry;
    if (!geom) return null;
    // Toma primer anillo exterior
    let ring: [number, number][] | null = null;
    if (geom.type === "Polygon") ring = geom.coordinates?.[0] ?? null;
    else if (geom.type === "MultiPolygon") ring = geom.coordinates?.[0]?.[0] ?? null;
    if (!ring || ring.length < 4) return null;
    return ring;
  } catch (_e) {
    return null;
  }
}

function ringEdges(ring: [number, number][]): { a: [number, number]; b: [number, number]; len: number; bearing: number; midpoint: [number, number] }[] {
  const out: ReturnType<typeof ringEdges> = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1];
    out.push({
      a, b,
      len: haversine(a, b),
      bearing: bearing(a, b),
      midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    });
  }
  return out;
}

function ringCentroid(ring: [number, number][]): [number, number] {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sx += ring[i][0]; sy += ring[i][1]; n++;
  }
  return [sx / n, sy / n];
}

// ---------- Google geocode → street bearing ----------
async function streetBearingFromGoogle(lat: number, lon: number, apiKey: string): Promise<{ bearing: number; street?: string } | null> {
  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&result_type=street_address|route&key=${apiKey}`,
    );
    const j = await r.json();
    const res = j?.results?.[0];
    const street = res?.address_components?.find((c: any) => c.types?.includes("route"))?.long_name;
    const vp = res?.geometry?.viewport;
    if (!vp?.northeast || !vp?.southwest) return null;
    // viewport diagonal aproxima orientación; en calles, normalmente alineada con la calle
    const ne: [number, number] = [vp.northeast.lng, vp.northeast.lat];
    const sw: [number, number] = [vp.southwest.lng, vp.southwest.lat];
    return { bearing: bearing(sw, ne), street };
  } catch (_e) {
    return null;
  }
}

// ---------- Street View ----------
async function fetchStreetView(lat: number, lon: number, heading: number, apiKey: string): Promise<ArrayBuffer | null> {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=${SV_SIZE}&location=${lat},${lon}&heading=${heading.toFixed(2)}&fov=${SV_FOV}&pitch=10&source=outdoor&key=${apiKey}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok && r.headers.get("content-type")?.includes("image")) {
        return await r.arrayBuffer();
      }
    } catch (_e) { /* ignore */ }
    await new Promise((res) => setTimeout(res, 300 * Math.pow(3, attempt)));
  }
  return null;
}

async function checkPanoramaExists(lat: number, lon: number, apiKey: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}&radius=30&source=outdoor&key=${apiKey}`,
    );
    const j = await r.json();
    return j?.status === "OK";
  } catch { return false; }
}

// ---------- Autoridad Catastro: derivaciones ----------
function derivePlantasResidenciales(plantas: Planta[]): {
  inferred_floor_count: number;
  has_entresuelo: boolean;
  plantas_tipo: number;
  plantas_tipo_codigos: string[];
} {
  const residencialCodes = new Set(["BJ", "EN", "BC"]);
  const overground = plantas.filter((p) => {
    const c = p.codigo;
    if (c.startsWith("-") || c.startsWith("S")) return false;
    if (c === "CUB" || c === "TZA") return false;
    return true;
  });
  const has_entresuelo = plantas.some((p) => p.codigo === "EN");
  const plantas_tipo_codigos = overground
    .filter((p) => /^\d{2}$/.test(p.codigo))
    .map((p) => p.codigo);
  return {
    inferred_floor_count: overground.length,
    has_entresuelo,
    plantas_tipo: plantas_tipo_codigos.length,
    plantas_tipo_codigos,
  };
}

// ---------- VLM JSON parsing ----------
function tryParseVlmJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(t);
  if (fence) t = fence[1].trim();
  // intenta extraer el primer objeto {...}
  const m = /\{[\s\S]*\}/.exec(t);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ---------- VLM call ----------
async function callVlm(imagesBase64: string[], ctx: {
  inferred_floor_count: number;
  has_entresuelo: boolean;
  plantas_tipo: number;
  longitud_fachada_m: number | null;
}): Promise<{ raw: string; parsed: any | null }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const prompt = `Eres un arquitecto técnico analizando una fachada de un edificio residencial en Madrid. Te paso 3 fotos de Street View del mismo edificio desde 3 puntos distintos de la calle.

DEFINICIÓN VINCULANTE de "ventana":
Hueco arquitectónico en una habitación con salida al exterior que permite segregar esa habitación como pieza habitable independiente.
- Un mirador (bow window) = 1 ventana (no cuentes los paños individuales)
- Una puerta-balcón = 1 ventana
- Un balcón corrido con 2 puertas-balcón a habitaciones distintas = 2 ventanas
- Ventanas de escalera = NO cuentan

DATOS DE CATASTRO (vinculantes, no contradigas):
- Plantas habitables sobre rasante: ${ctx.inferred_floor_count}
- Tiene entresuelo: ${ctx.has_entresuelo}
- Plantas tipo residenciales (P01..PN): ${ctx.plantas_tipo}
- Longitud fachada principal (m): ${ctx.longitud_fachada_m ?? "desconocida"}

TU TAREA:
Identifica los EJES VERTICALES de huecos en la fachada principal. Un eje vertical es una columna de huecos alineada que va desde planta baja hasta la última planta visible.

Cuenta los ejes reconciliando las 3 imágenes: una ve mejor la izquierda, otra el centro, otra la derecha. Si un eje está parcialmente tapado por árboles, toldos o vehículos pero ves huecos arriba alineados verticalmente, el eje existe completo.

Aplica la fórmula:
  total = ejes × plantas_tipo + ventanas_planta_baja + ventanas_entresuelo
  ventanas_planta_baja  = ejes - 1 si hay portal en esta fachada
  ventanas_entresuelo   = ejes - 1 si hay entresuelo

DEVUELVE EXCLUSIVAMENTE JSON con esta forma:
{
  "ejes_verticales_detectados": N,
  "razon_del_conteo": "...",
  "hay_portal_en_fachada_principal": boolean,
  "ventanas_planta_baja": M,
  "ventanas_entresuelo": K,
  "ventanas_plantas_tipo": N * plantas_tipo,
  "total": M + K + N * plantas_tipo,
  "miradores_detectados": número,
  "balcones_corridos_detectados": número,
  "confianza": "alta" | "media" | "baja",
  "flags": [],
  "edificio_hace_esquina": boolean,
  "se_ve_segunda_fachada": boolean,
  "ejes_por_imagen": [
    { "image_index": 0, "ejes_visibles": N, "completos": boolean },
    { "image_index": 1, "ejes_visibles": N, "completos": boolean },
    { "image_index": 2, "ejes_visibles": N, "completos": boolean }
  ]
}`;

  const content: any[] = [{ type: "text", text: prompt }];
  for (const b64 of imagesBase64) {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content }],
    }),
  });
  const text = await r.text();
  let raw = text;
  try {
    const j = JSON.parse(text);
    raw = j?.choices?.[0]?.message?.content ?? text;
  } catch { /* keep raw */ }
  return { raw, parsed: tryParseVlmJson(raw) };
}

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) return err("GOOGLE_MAPS_API_KEY no configurada", 400);
  if (!Deno.env.get("LOVABLE_API_KEY")) return err("LOVABLE_API_KEY no configurada", 400);

  try {
    const body = await req.json().catch(() => ({}));
    const { building_id, force } = body as { building_id?: string; force?: boolean };
    if (!building_id) return err("building_id requerido", 400);

    const sb = getServiceClient();
    const flags: string[] = [];

    // (A) Autoridad Catastro
    const { data: bldg } = await sb
      .from("buildings")
      .select("refcatastral, metadatos")
      .eq("id", building_id).maybeSingle();
    let rc14 = (bldg?.refcatastral ?? (bldg?.metadatos as any)?.referencia_catastral ?? "")
      .toString().replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14);

    let { data: auth } = await sb
      .from("catastro_authority_cache")
      .select("*").eq("refcatastral_14", rc14).maybeSingle();

    if (!auth || (auth.fetched_at && Date.now() - new Date(auth.fetched_at as string).getTime() > 30 * 24 * 3600 * 1000)) {
      const inv = await sb.functions.invoke("catastro-authority-layer", {
        body: { building_id, refcatastral: rc14 || undefined },
      });
      const a = (inv.data as any)?.authority;
      if (a?.refcatastral_14) {
        rc14 = a.refcatastral_14;
        const re = await sb.from("catastro_authority_cache").select("*").eq("refcatastral_14", rc14).maybeSingle();
        auth = re.data;
      }
    }
    if (!auth || !rc14) return json({ error: "no_authority_for_building", building_id }, 200);

    const plantas = (auth.plantas as Planta[]) ?? [];
    const derived = derivePlantasResidenciales(plantas);
    const centroidLat = auth.lat as number | null;
    const centroidLon = auth.lon as number | null;
    if (!centroidLat || !centroidLon) return json({ error: "no_centroid", rc14 }, 200);

    if (derived.plantas_tipo === 0) flags.push("sin_plantas_tipo");

    // (B) Geometría: WMS-INSPIRE → polígono parcela → arista de fachada
    let longitud_fachada_m: number | null = null;
    let longitud_fachada_source: "wms_inspire" | "sqrt_area_fallback" = "sqrt_area_fallback";
    let heading_fachada: number | null = null;
    let polyCentroid: [number, number] | null = null;

    const ring = await fetchParcelPolygon(rc14);
    let edges: ReturnType<typeof ringEdges> = [];
    if (ring && ring.length >= 4) {
      edges = ringEdges(ring);
      polyCentroid = ringCentroid(ring);
      // Bearing de la calle vía Google (viewport del street_address)
      const streetInfo = await streetBearingFromGoogle(centroidLat, centroidLon, apiKey);
      const streetBearingDeg = streetInfo?.bearing ?? null;

      // Elige arista cuyo bearing sea más PARALELO a la calle (la fachada va paralela a la calle).
      // Si no hay info de calle, escoge la arista más larga.
      let best = edges[0];
      let bestScore = -Infinity;
      for (const e of edges) {
        const score = streetBearingDeg != null
          ? (90 - angularDiff(e.bearing, streetBearingDeg)) * 1000 + e.len // paralela ≈ 0° diff
          : e.len;
        if (score > bestScore) { bestScore = score; best = e; }
      }
      longitud_fachada_m = best.len;
      longitud_fachada_source = "wms_inspire";
      // Heading hacia la fachada: normal exterior a la arista, apuntando desde el lado-calle hacia la parcela.
      const normalLeft = (best.bearing - 90 + 360) % 360;
      const normalRight = (best.bearing + 90) % 360;
      // El "exterior" es el sentido cuya proyección desde midpoint se aleja del centroide.
      const probe1 = offsetAlongBearing(best.midpoint[1], best.midpoint[0], 5, normalLeft);
      const probe2 = offsetAlongBearing(best.midpoint[1], best.midpoint[0], 5, normalRight);
      const d1 = haversine([probe1.lon, probe1.lat], polyCentroid);
      const d2 = haversine([probe2.lon, probe2.lat], polyCentroid);
      const outsideBearing = d1 > d2 ? normalLeft : normalRight;
      // La cámara está FUERA y mira HACIA la fachada → heading = outsideBearing + 180.
      heading_fachada = (outsideBearing + 180) % 360;
    } else {
      flags.push("longitud_fachada_estimada");
      const sup = Number(auth.superficie_parcela_m2 ?? 0);
      longitud_fachada_m = sup > 0 ? Math.sqrt(sup) : null;
      // Sin polígono, heading = bearing desde panorama hacia centroide (Google StreetView Metadata)
      try {
        const m = await fetch(
          `https://maps.googleapis.com/maps/api/streetview/metadata?location=${centroidLat},${centroidLon}&radius=50&source=outdoor&key=${apiKey}`,
        ).then((r) => r.json());
        if (m?.status === "OK" && m?.location) {
          heading_fachada = bearing([m.location.lng, m.location.lat], [centroidLon, centroidLat]);
        }
      } catch { /* ignore */ }
      if (heading_fachada == null) heading_fachada = 0;
    }

    // (C) Tres capturas Street View (con caché)
    const captures: { lat: number; lng: number; heading: number; storage_path: string; b64?: string }[] = [];
    const insideBearing = (heading_fachada! + 180) % 360; // desde fachada hacia la calle (alejarse 8m)
    const tangent = (heading_fachada! + 90) % 360;
    const points = [
      offsetAlongBearing(centroidLat, centroidLon, 8, insideBearing), // central, alejado 8m hacia calle
      offsetAlongBearing(
        ...Object.values(offsetAlongBearing(centroidLat, centroidLon, 8, insideBearing)) as [number, number],
        6, tangent,
      ),
      offsetAlongBearing(
        ...Object.values(offsetAlongBearing(centroidLat, centroidLon, 8, insideBearing)) as [number, number],
        6, (tangent + 180) % 360,
      ),
    ];

    for (let i = 0; i < 3; i++) {
      const { lat, lon } = points[i];
      const storage_path = `${building_id}/${i}.jpg`;
      let buf: ArrayBuffer | null = null;

      if (!force) {
        // Caché: revisar si existe y es fresca
        const { data: list } = await sb.storage.from(BUCKET).list(building_id, { limit: 10 });
        const found = list?.find((o) => o.name === `${i}.jpg`);
        const fresh = found && found.updated_at && (Date.now() - new Date(found.updated_at).getTime() < TTL_CAPTURES_MS);
        if (fresh) {
          const dl = await sb.storage.from(BUCKET).download(storage_path);
          if (!dl.error && dl.data) buf = await dl.data.arrayBuffer();
        }
      }

      if (!buf) {
        const exists = await checkPanoramaExists(lat, lon, apiKey);
        if (!exists) continue;
        buf = await fetchStreetView(lat, lon, heading_fachada!, apiKey);
        if (!buf) continue;
        await sb.storage.from(BUCKET).upload(storage_path, new Uint8Array(buf), {
          contentType: "image/jpeg",
          upsert: true,
        });
      }
      captures.push({ lat, lng: lon, heading: heading_fachada!, storage_path, b64: ab2b64(buf) });
    }

    if (captures.length < 3) flags.push("cobertura_streetview_insuficiente");

    // (D) VLM
    let vlmRaw = "";
    let vlmParsed: any = null;
    if (captures.length > 0) {
      const res = await callVlm(captures.map((c) => c.b64!), {
        inferred_floor_count: derived.inferred_floor_count,
        has_entresuelo: derived.has_entresuelo,
        plantas_tipo: derived.plantas_tipo,
        longitud_fachada_m,
      });
      vlmRaw = res.raw;
      vlmParsed = res.parsed;
    }

    // (E) Validación dura + fórmula determinista
    const ejesVlm = Number(vlmParsed?.ejes_verticales_detectados ?? 0);
    const hayPortal = vlmParsed?.hay_portal_en_fachada_principal !== false;
    const ejes = ejesVlm;
    const plantas_tipo = derived.plantas_tipo;
    const has_entresuelo = derived.has_entresuelo;
    const vbp = hayPortal ? Math.max(0, ejes - 1) : ejes;
    const ven = has_entresuelo ? Math.max(0, ejes - 1) : 0;
    const vtt = ejes * plantas_tipo;
    const totalFormula = vtt + vbp + ven;

    if (ejes < 3 || ejes > 15) flags.push("ejes_fuera_de_rango");
    if (longitud_fachada_source === "wms_inspire" && longitud_fachada_m && longitud_fachada_m > 0) {
      const dens = totalFormula / longitud_fachada_m;
      if (dens < 1.5 || dens > 4.5) flags.push("densidad_inusual");
    }
    if (vlmParsed && typeof vlmParsed.total === "number" && vlmParsed.total !== totalFormula) {
      flags.push("formula_no_se_cumple");
    }
    if (vlmParsed?.ejes_por_imagen && Array.isArray(vlmParsed.ejes_por_imagen)) {
      const vals = vlmParsed.ejes_por_imagen.map((x: any) => Number(x.ejes_visibles)).filter((n: number) => isFinite(n));
      if (vals.length >= 2 && Math.max(...vals) - Math.min(...vals) > 2) flags.push("divergencia_entre_capturas");
    }

    let confidence: "alta" | "media" | "baja" = "alta";
    if (vlmParsed?.confianza) confidence = vlmParsed.confianza;
    if (flags.includes("cobertura_streetview_insuficiente")) confidence = "baja";
    if (flags.includes("ejes_fuera_de_rango")) confidence = "baja";
    else if (flags.includes("divergencia_entre_capturas") && confidence === "alta") confidence = "media";

    const fachada_principal = {
      ejes_verticales_detectados: ejes,
      plantas_tipo,
      ventanas_planta_baja: vbp,
      ventanas_entresuelo: ven,
      ventanas_plantas_tipo: vtt,
      total: totalFormula,
      confidence,
      flags,
      razon_del_conteo: vlmParsed?.razon_del_conteo ?? null,
      miradores_detectados: vlmParsed?.miradores_detectados ?? null,
      balcones_corridos_detectados: vlmParsed?.balcones_corridos_detectados ?? null,
      ejes_por_imagen: vlmParsed?.ejes_por_imagen ?? null,
    };

    // (G) Persistir
    const insertRes = await sb.from("facade_window_counts").insert({
      building_id,
      refcatastral_14: rc14,
      vlm_raw_response: vlmRaw || "",
      vlm_parsed: vlmParsed,
      street_view_panoramas: captures.map((c) => ({ lat: c.lat, lng: c.lng, heading: c.heading, storage_path: c.storage_path })),
      fachada_principal,
      fachada_secundaria: null,
      longitud_fachada_m,
      longitud_fachada_source,
      final_count: totalFormula,
      ejes_verticales: ejes,
      confidence,
      flags,
    }).select("id").maybeSingle();

    return json({
      fachada_principal,
      fachada_secundaria: null,
      total_ventanas_fachada_exterior: totalFormula,
      longitud_fachada_m,
      longitud_fachada_source,
      heading_fachada,
      plantas_tipo_codigos: derived.plantas_tipo_codigos,
      inferred_floor_count: derived.inferred_floor_count,
      has_entresuelo: derived.has_entresuelo,
      notas_vlm: vlmParsed?.razon_del_conteo ?? null,
      audit_id: insertRes.data?.id ?? null,
    }, 200);
  } catch (e) {
    console.error("count-facade-windows error", e);
    return err(String((e as Error).message ?? e), 500);
  }
});