// count-facade-windows
// Fase 5: cuenta ventanas de fachada con rejilla anclada a Catastro.
// El VLM solo identifica ejes verticales; la fórmula calcula el total.
//   total = ejes × plantas_tipo + ventanas_planta_baja + ventanas_entresuelo
// Validado contra Díaz Porlier 47 → 47 ventanas (7 ejes × 5 + 6 + 6).

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";
import { fetchParcelGeometry, type StreetEdge } from "../_shared/parcel_geometry.ts";

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
  longitud_principal_m: number | null;
  longitud_secundaria_m: number | null;
  es_esquina: boolean;
  fachada_label: "principal" | "secundaria";
}): Promise<{ raw: string; parsed: any | null }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const prompt = `Eres un arquitecto técnico analizando UNA fachada concreta de un edificio residencial en Madrid. Te paso 3 fotos de Street View de la MISMA fachada (la "${ctx.fachada_label}") desde 3 puntos distintos.

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
- Edificio en esquina: ${ctx.es_esquina ? "SÍ (analiza SOLO la fachada indicada)" : "no"}
- Longitud fachada principal (m): ${ctx.longitud_principal_m ?? "desconocida"}
- Longitud fachada secundaria (m): ${ctx.longitud_secundaria_m ?? "no aplica"}
- ESTÁS ANALIZANDO la fachada: ${ctx.fachada_label.toUpperCase()}

TU TAREA:
Identifica los EJES VERTICALES de huecos en ESTA fachada (la ${ctx.fachada_label}). Un eje vertical es una columna de huecos alineada que va desde planta baja hasta la última planta visible.

Cuenta los ejes reconciliando las 3 imágenes: una ve mejor la izquierda, otra el centro, otra la derecha. Si un eje está parcialmente tapado por árboles, toldos o vehículos pero ves huecos arriba alineados verticalmente, el eje existe completo. Si la fachada continúa al doblar en esquina, NO incluyas los ejes de la otra fachada — solo los de esta cara.

Aplica la fórmula:
  total = ejes × plantas_tipo + ventanas_planta_baja + ventanas_entresuelo
  ventanas_planta_baja  = ejes - 1 si hay portal en ESTA fachada (los locales comerciales sí cuentan como ventanas)
  ventanas_entresuelo   = ejes - 1 si hay entresuelo

DEVUELVE EXCLUSIVAMENTE JSON con esta forma:
{
  "fachada_analizada": "${ctx.fachada_label}",
  "ejes_verticales_detectados": N,
  "razon_del_conteo": "...",
  "hay_portal_en_esta_fachada": boolean,
  "ventanas_planta_baja": M,
  "ventanas_entresuelo": K,
  "ventanas_plantas_tipo": N * plantas_tipo,
  "total": M + K + N * plantas_tipo,
  "miradores_detectados": número,
  "balcones_corridos_detectados": número,
  "confianza": "alta" | "media" | "baja",
  "flags": [],
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
      .select("refcatastral, metadatos, es_esquina_manual")
      .eq("id", building_id).maybeSingle();
    let rc14 = (bldg?.refcatastral ?? (bldg?.metadatos as any)?.referencia_catastral ?? "")
      .toString().replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14);
    const esEsquinaManual: boolean | null = (bldg?.es_esquina_manual ?? null) as boolean | null;

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
    const geom = await fetchParcelGeometry({
      refcatastral_14: rc14,
      lat: centroidLat,
      lon: centroidLon,
      force: !!force,
      sbAdmin: sb,
      expected_area_m2: auth.superficie_parcela_m2 as number | null,
    });
    for (const f of geom.flags) if (!flags.includes(f)) flags.push(f);

    // (B.1) Seleccionar fachadas a calle desde street_edges geométricos
    type Fachada = {
      role: "principal" | "secundaria";
      edge: StreetEdge;
      captures: { lat: number; lng: number; heading: number; storage_path: string; b64?: string }[];
      vlm_raw: string;
      vlm_parsed: any;
      ejes: number;
      hay_portal: boolean;
      vbp: number; ven: number; vtt: number; total: number;
    };
    const fachadas: Fachada[] = [];
    const street_edges = (geom.street_edges ?? []) as StreetEdge[];
    const es_esquina_geom = !!geom.is_corner;
    // Override manual: prioridad máxima. Si es_esquina_manual no es null, manda.
    const es_esquina_final = esEsquinaManual !== null ? esEsquinaManual : es_esquina_geom;
    const esquina_source_final = esEsquinaManual !== null
      ? "manual"
      : (street_edges.length > 0 ? "geometria_parcela" : "no_detectable");
    const total_street_len = Number(geom.total_street_length_m ?? 0);
    let longitud_fachada_source: string = geom.source;

    if (street_edges.length > 0) {
      const principal = street_edges.find((e) => e.role === "principal") ?? street_edges[0];
      let secundaria = es_esquina_final
        ? street_edges.find((e) => e.role === "secundaria")
        : undefined;
      // Si el override manual fuerza esquina pero la detección sólo encontró 1 arista
      // a calle, escogemos como secundaria la arista más larga del polígono que no
      // sea paralela a la principal (ángulo entre 60 y 120 grados).
      if (es_esquina_final && !secundaria) {
        const ring = (geom.exterior_ring ?? []) as [number, number][];
        const candidates: StreetEdge[] = [];
        for (let i = 0; i < ring.length - 1; i++) {
          if (i === principal.index) continue;
          const a = ring[i], b = ring[i + 1];
          const dLat = (b[1] - a[1]) * Math.PI / 180;
          const dLon = (b[0] - a[0]) * Math.PI / 180;
          const lat1 = a[1] * Math.PI / 180; const lat2 = b[1] * Math.PI / 180;
          const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
          const len = 2 * 6371000 * Math.asin(Math.sqrt(h));
          if (len < 3) continue;
          const y = Math.sin(dLon) * Math.cos(lat2);
          const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
          const brg = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
          let diff = Math.abs(((principal.bearing - brg + 540) % 360) - 180);
          const sep = diff > 90 ? 180 - diff : diff;
          if (sep >= 50 && sep <= 130) {
            // outside_bearing: el que aleja del centroide
            const mid: [number, number] = [(a[0]+b[0])/2, (a[1]+b[1])/2];
            const nL = (brg - 90 + 360) % 360;
            const nR = (brg + 90) % 360;
            const off = (lat: number, lon: number, d: number, brgDeg: number) => {
              const dx = d * Math.sin(brgDeg*Math.PI/180);
              const dy = d * Math.cos(brgDeg*Math.PI/180);
              return { lat: lat + dy/111320, lon: lon + dx/(111320*Math.cos(lat*Math.PI/180)) };
            };
            const ctr = { lat: geom.centroid.lat, lon: geom.centroid.lon };
            const pL = off(mid[1], mid[0], 5, nL);
            const pR = off(mid[1], mid[0], 5, nR);
            const distL = Math.hypot(pL.lon - ctr.lon, pL.lat - ctr.lat);
            const distR = Math.hypot(pR.lon - ctr.lon, pR.lat - ctr.lat);
            const outside_bearing = distL > distR ? nL : nR;
            const heading = (outside_bearing + 180) % 360;
            candidates.push({
              index: i, a, b, len_m: len, bearing: brg, midpoint: mid,
              outside_bearing, heading, probes_hit: 0,
              role: "secundaria", street_source: undefined,
            } as StreetEdge);
          }
        }
        candidates.sort((x, y) => y.len_m - x.len_m);
        if (candidates[0]) {
          secundaria = candidates[0];
          street_edges.push(secundaria);
          flags.push("secundaria_inferida_por_override_manual");
        }
      }
      if (principal) fachadas.push({
        role: "principal", edge: principal, captures: [], vlm_raw: "", vlm_parsed: null,
        ejes: 0, hay_portal: true, vbp: 0, ven: 0, vtt: 0, total: 0,
      });
      if (secundaria) fachadas.push({
        role: "secundaria", edge: secundaria, captures: [], vlm_raw: "", vlm_parsed: null,
        ejes: 0, hay_portal: false, vbp: 0, ven: 0, vtt: 0, total: 0,
      });
    } else {
      // Fallback: sin aristas a calle detectadas → 1 captura desde panorama hacia centroide
      flags.push("esquina_no_detectable_por_geometria");
      flags.push("sin_aristas_a_calle_detectadas");
      let heading_fallback = 0;
      try {
        const m = await fetch(
          `https://maps.googleapis.com/maps/api/streetview/metadata?location=${centroidLat},${centroidLon}&radius=50&source=outdoor&key=${apiKey}`,
        ).then((r) => r.json());
        if (m?.status === "OK" && m?.location) {
          heading_fallback = bearing([m.location.lng, m.location.lat], [centroidLon, centroidLat]);
        }
      } catch { /* ignore */ }
      const fakeEdge: StreetEdge = {
        index: -1, a: [centroidLon, centroidLat], b: [centroidLon, centroidLat],
        len_m: Number(auth.superficie_parcela_m2 ?? 0) > 0 ? Math.sqrt(Number(auth.superficie_parcela_m2)) : 12,
        bearing: 0, midpoint: [centroidLon, centroidLat],
        outside_bearing: (heading_fallback + 180) % 360, heading: heading_fallback, probes_hit: 0,
        role: "principal",
      };
      fachadas.push({
        role: "principal", edge: fakeEdge, captures: [], vlm_raw: "", vlm_parsed: null,
        ejes: 0, hay_portal: true, vbp: 0, ven: 0, vtt: 0, total: 0,
      });
      longitud_fachada_source = "sqrt_area_fallback";
    }

    // (C) Capturas Street View — 3 por fachada
    await Promise.all(fachadas.map(async (f) => {
      const e = f.edge;
      const heading = e.heading;
      const insideBearing = (heading + 180) % 360;
      const tangent = (heading + 90) % 360;
      const midLat = e.midpoint[1], midLon = e.midpoint[0];
      const center = offsetAlongBearing(midLat, midLon, 8, insideBearing);
      const sideOff = Math.min(8, Math.max(3, e.len_m / 3));
      const left = offsetAlongBearing(center.lat, center.lon, sideOff, tangent);
      const right = offsetAlongBearing(center.lat, center.lon, sideOff, (tangent + 180) % 360);
      const pts = [center, left, right];
      const results = await Promise.all(pts.map(async ({ lat, lon }, i) => {
        const storage_path = `${building_id}/${f.role}_${i}.jpg`;
        let buf: ArrayBuffer | null = null;
        if (!force) {
          const dl = await sb.storage.from(BUCKET).download(storage_path);
          if (!dl.error && dl.data) buf = await dl.data.arrayBuffer();
        }
        if (!buf) {
          const exists = await checkPanoramaExists(lat, lon, apiKey);
          if (!exists) return null;
          buf = await fetchStreetView(lat, lon, heading, apiKey);
          if (!buf) return null;
          await sb.storage.from(BUCKET).upload(storage_path, new Uint8Array(buf), {
            contentType: "image/jpeg", upsert: true,
          });
        }
        return { lat, lng: lon, heading, storage_path, b64: ab2b64(buf) };
      }));
      f.captures = results.filter((x): x is NonNullable<typeof x> => !!x);
      if (f.captures.length < 3) flags.push(`cobertura_streetview_insuficiente_${f.role}`);
    }));

    // (D) VLM por fachada — paralelo
    const principalLen = fachadas.find((f) => f.role === "principal")?.edge.len_m ?? null;
    const secundariaLen = fachadas.find((f) => f.role === "secundaria")?.edge.len_m ?? null;
    await Promise.all(fachadas.map(async (f) => {
      if (f.captures.length === 0) return;
      const res = await callVlm(f.captures.map((c) => c.b64!), {
        inferred_floor_count: derived.inferred_floor_count,
        has_entresuelo: derived.has_entresuelo,
        plantas_tipo: derived.plantas_tipo,
        longitud_principal_m: principalLen,
        longitud_secundaria_m: secundariaLen,
        es_esquina: es_esquina_final,
        fachada_label: f.role,
      });
      f.vlm_raw = res.raw;
      f.vlm_parsed = res.parsed;
      const ejes = Number(res.parsed?.ejes_verticales_detectados ?? 0);
      const hayPortal = res.parsed?.hay_portal_en_esta_fachada !== false && f.role === "principal";
      f.ejes = ejes;
      f.hay_portal = !!hayPortal;
      f.vbp = hayPortal ? Math.max(0, ejes - 1) : (f.role === "principal" ? ejes : 0);
      f.ven = derived.has_entresuelo ? Math.max(0, ejes - 1) : 0;
      f.vtt = ejes * derived.plantas_tipo;
      f.total = f.vtt + f.vbp + f.ven;
      if (ejes < 2 || ejes > 15) flags.push(`ejes_fuera_de_rango_${f.role}`);
    }));

    // (E) Suma de fachadas
    const fachada_principal_obj = fachadas.find((f) => f.role === "principal");
    const fachada_secundaria_obj = fachadas.find((f) => f.role === "secundaria");
    const ejes_total = fachadas.reduce((s, f) => s + f.ejes, 0);
    const total_ventanas = fachadas.reduce((s, f) => s + f.total, 0);
    const longitud_fachada_total_m = fachadas.reduce((s, f) => s + (f.edge.len_m || 0), 0);
    const longitud_fachada_principal_m = fachada_principal_obj?.edge.len_m ?? null;

    let confidence: "alta" | "media" | "baja" = "alta";
    if (flags.some((f) => f.startsWith("cobertura_streetview_insuficiente"))) confidence = "media";
    if (flags.includes("polygon_no_fiable") || flags.includes("esquina_no_detectable_por_geometria")) confidence = "baja";
    if (flags.some((f) => f.startsWith("ejes_fuera_de_rango"))) confidence = "baja";

    const fachadas_a_calle = fachadas.map((f) => ({
      role: f.role,
      len_m: f.edge.len_m,
      heading: f.edge.heading,
      ejes: f.ejes,
      total: f.total,
      vbp: f.vbp, ven: f.ven, vtt: f.vtt,
      capturas: f.captures.length,
    }));

    const fachada_principal = fachada_principal_obj ? {
      ejes_verticales_detectados: fachada_principal_obj.ejes,
      plantas_tipo: derived.plantas_tipo,
      ventanas_planta_baja: fachada_principal_obj.vbp,
      ventanas_entresuelo: fachada_principal_obj.ven,
      ventanas_plantas_tipo: fachada_principal_obj.vtt,
      total: fachada_principal_obj.total,
      longitud_m: fachada_principal_obj.edge.len_m,
      heading: fachada_principal_obj.edge.heading,
      razon_del_conteo: fachada_principal_obj.vlm_parsed?.razon_del_conteo ?? null,
      ejes_por_imagen: fachada_principal_obj.vlm_parsed?.ejes_por_imagen ?? null,
    } : null;
    const fachada_secundaria = fachada_secundaria_obj ? {
      ejes_verticales_detectados: fachada_secundaria_obj.ejes,
      plantas_tipo: derived.plantas_tipo,
      ventanas_planta_baja: fachada_secundaria_obj.vbp,
      ventanas_entresuelo: fachada_secundaria_obj.ven,
      ventanas_plantas_tipo: fachada_secundaria_obj.vtt,
      total: fachada_secundaria_obj.total,
      longitud_m: fachada_secundaria_obj.edge.len_m,
      heading: fachada_secundaria_obj.edge.heading,
      razon_del_conteo: fachada_secundaria_obj.vlm_parsed?.razon_del_conteo ?? null,
      ejes_por_imagen: fachada_secundaria_obj.vlm_parsed?.ejes_por_imagen ?? null,
    } : null;

    const allPanoramas = fachadas.flatMap((f) => f.captures.map((c) => ({
      role: f.role, lat: c.lat, lng: c.lng, heading: c.heading, storage_path: c.storage_path,
    })));
    const vlmRaw = fachadas.map((f) => `[${f.role}]\n${f.vlm_raw}`).join("\n---\n");
    const vlmParsed = {
      principal: fachada_principal_obj?.vlm_parsed ?? null,
      secundaria: fachada_secundaria_obj?.vlm_parsed ?? null,
    };

    const insertRes = await sb.from("facade_window_counts").insert({
      building_id,
      refcatastral_14: rc14,
      vlm_raw_response: vlmRaw,
      vlm_parsed: vlmParsed,
      street_view_panoramas: allPanoramas,
      fachada_principal,
      fachada_secundaria,
      longitud_fachada_m: longitud_fachada_principal_m,
      longitud_fachada_source,
      final_count: total_ventanas,
      ejes_verticales: ejes_total,
      confidence,
      flags,
      es_esquina: es_esquina_geom,
      esquina_source: street_edges.length > 0 ? "geometria_parcela" : "no_detectable",
      fachadas_a_calle,
      longitud_fachada_total_m,
    }).select("id").maybeSingle();

    return json({
      source_geometria: geom.source,
      area_polygon_m2: geom.area_m2,
      polygon_confidence: geom.confidence,
      es_esquina: es_esquina_geom,
      esquina_source: street_edges.length > 0 ? "geometria_parcela" : "no_detectable",
      longitud_fachada_total_m,
      longitud_fachada_principal_m,
      longitud_fachada_secundaria_m: secundariaLen,
      total_ventanas_fachada_exterior: total_ventanas,
      ejes_total,
      fachada_principal,
      fachada_secundaria,
      heading_fachada: fachada_principal?.heading ?? null,
      plantas_tipo_codigos: derived.plantas_tipo_codigos,
      inferred_floor_count: derived.inferred_floor_count,
      has_entresuelo: derived.has_entresuelo,
      confidence,
      flags,
      audit_id: insertRes.data?.id ?? null,
    }, 200);
  } catch (e) {
    console.error("count-facade-windows error", e);
    return err(String((e as Error).message ?? e), 500);
  }
});