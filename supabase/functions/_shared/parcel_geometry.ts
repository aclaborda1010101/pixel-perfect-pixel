// Módulo compartido: geometría de parcela.
// Estrategia: Overpass (OSM) primario → WFS-INSPIRE fallback → fallback geométrico.
// Cachea en `parcel_geometry_cache` por rc14, TTL 180 días.

export type GeometrySource =
  | "overpass_ref"
  | "overpass_bbox"
  | "wfs_inspire"
  | "fallback"
  | "cache";

export interface ParcelGeometry {
  refcatastral_14: string;
  exterior_ring: [number, number][]; // [lon, lat]
  interior_rings: [number, number][][];
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  centroid: { lat: number; lon: number };
  area_m2: number;
  perimeter_m: number;
  source: GeometrySource;
  confidence: "alta" | "media" | "baja";
  flags: string[];
  osm_id?: number;
  osm_type?: "way" | "relation";
  cached: boolean;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const HTTP_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS_PER_ENDPOINT = 3;
const MAX_BACKOFF_MS = 4_000;
const UA = "AffluxOS/1.0 (https://affluxos.com; geometry-fetcher)";

// ---------- Helpers geométricos ----------
const toRad = (d: number) => (d * Math.PI) / 180;

function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ringArea(ring: [number, number][]): number {
  if (ring.length < 4) return 0;
  const lat0 = ring[0][1];
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(toRad(lat0));
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * mPerDegLon;
    const y1 = ring[i][1] * mPerDegLat;
    const x2 = ring[i + 1][0] * mPerDegLon;
    const y2 = ring[i + 1][1] * mPerDegLat;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function ringPerimeter(ring: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += haversine(ring[i], ring[i + 1]);
  return s;
}

function bboxOf(ring: [number, number][]) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

function centroidOf(ring: [number, number][]) {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sx += ring[i][0]; sy += ring[i][1]; n++;
  }
  return { lat: sy / n, lon: sx / n };
}

function ensureClosed(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return ring;
  const [x0, y0] = ring[0];
  const [xn, yn] = ring[ring.length - 1];
  if (x0 === xn && y0 === yn) return ring;
  return [...ring, [x0, y0]];
}

function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distPointToRing(pt: [number, number], ring: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = haversine(pt, ring[i]);
    if (d < best) best = d;
  }
  return best;
}

// ---------- HTTP helper con timeout ----------
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = HTTP_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

// ---------- Overpass calls ----------
async function callOverpass(query: string): Promise<any | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ENDPOINT; attempt++) {
      try {
        const r = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": "AffluxOS/1.0 (geometry-fetch; contact: ops@affluxos.com)",
          },
          body: query,
        });
        if (r.ok) {
          const j = await r.json();
          return j;
        }
        if (!RETRYABLE.has(r.status)) {
          console.warn(`overpass non-retryable ${r.status} @ ${endpoint}`);
          break; // siguiente endpoint
        }
        // No respetamos Retry-After grande: si el endpoint nos manda esperar mucho,
        // pasamos directamente al siguiente. Sólo backoff corto.
        const retryAfter = Number(r.headers.get("retry-after")) || 0;
        if (retryAfter * 1000 > MAX_BACKOFF_MS) {
          console.warn(`overpass ${r.status} @ ${endpoint} retry-after ${retryAfter}s → next endpoint`);
          break;
        }
        const wait = Math.min(MAX_BACKOFF_MS, 500 * Math.pow(3, attempt));
        console.warn(`overpass ${r.status} @ ${endpoint} attempt ${attempt + 1}, waiting ${wait}ms`);
        await new Promise((res) => setTimeout(res, wait));
      } catch (e) {
        console.warn(`overpass error @ ${endpoint} attempt ${attempt + 1}: ${(e as Error).message}`);
        await new Promise((res) => setTimeout(res, Math.min(MAX_BACKOFF_MS, 500 * Math.pow(3, attempt))));
      }
    }
  }
  return null;
}

function parseOverpassElements(j: any): Array<{
  osm_id: number;
  osm_type: "way" | "relation";
  exterior_ring: [number, number][];
  interior_rings: [number, number][][];
  tags: Record<string, string>;
}> {
  const out: ReturnType<typeof parseOverpassElements> = [];
  const elements: any[] = j?.elements ?? [];
  for (const el of elements) {
    if (el.type === "way") {
      const geom: any[] = el.geometry ?? [];
      if (geom.length < 3) continue;
      const ring = ensureClosed(geom.map((p) => [p.lon, p.lat] as [number, number]));
      out.push({
        osm_id: el.id,
        osm_type: "way",
        exterior_ring: ring,
        interior_rings: [],
        tags: el.tags ?? {},
      });
    } else if (el.type === "relation") {
      const members: any[] = el.members ?? [];
      const outers: [number, number][][] = [];
      const inners: [number, number][][] = [];
      for (const m of members) {
        if (m.type !== "way" || !Array.isArray(m.geometry) || m.geometry.length < 2) continue;
        const coords = m.geometry.map((p: any) => [p.lon, p.lat] as [number, number]);
        if (m.role === "outer") outers.push(coords);
        else if (m.role === "inner") inners.push(coords);
      }
      const outerRing = stitchRing(outers);
      if (!outerRing) continue;
      const innerRings = inners
        .map((segs) => stitchRing([segs]) ?? ensureClosed(segs))
        .filter((r): r is [number, number][] => !!r && r.length >= 4);
      out.push({
        osm_id: el.id,
        osm_type: "relation",
        exterior_ring: ensureClosed(outerRing),
        interior_rings: innerRings.map(ensureClosed),
        tags: el.tags ?? {},
      });
    }
  }
  return out;
}

// Une segmentos compartiendo endpoints (suficiente para multipolygons simples).
function stitchRing(segments: [number, number][][]): [number, number][] | null {
  if (segments.length === 0) return null;
  if (segments.length === 1) return ensureClosed(segments[0]);
  const remaining = segments.map((s) => s.slice());
  const out: [number, number][] = remaining.shift()!.slice();
  let safety = remaining.length + 5;
  while (remaining.length > 0 && safety-- > 0) {
    const tail = out[out.length - 1];
    let pickIdx = -1, reverse = false;
    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      if (seg[0][0] === tail[0] && seg[0][1] === tail[1]) { pickIdx = i; reverse = false; break; }
      const last = seg[seg.length - 1];
      if (last[0] === tail[0] && last[1] === tail[1]) { pickIdx = i; reverse = true; break; }
    }
    if (pickIdx < 0) return null;
    const seg = remaining.splice(pickIdx, 1)[0];
    const ordered = reverse ? seg.slice().reverse() : seg;
    for (let k = 1; k < ordered.length; k++) out.push(ordered[k]);
  }
  return remaining.length === 0 ? ensureClosed(out) : null;
}

async function overpassByRef(rc14: string): Promise<{
  ring: [number, number][];
  inner: [number, number][][];
  osm_id: number;
  osm_type: "way" | "relation";
} | null> {
  // Probar rc14 completo y rc14 sin los 4 últimos chars (algunos OSM tienen sólo los 14 base).
  const candidates = Array.from(new Set([rc14, rc14.slice(0, 14)])).filter(Boolean);
  for (const ref of candidates) {
    const q = `[out:json][timeout:25];
(
  way["ref:catastral"="${ref}"];
  relation["ref:catastral"="${ref}"];
);
out geom;`;
    const j = await callOverpass(q);
    if (!j) return null;
    const els = parseOverpassElements(j);
    if (els.length > 0) {
      // Prefer relation > way; mayor área.
      els.sort((a, b) => {
        const typeRank = (t: string) => (t === "relation" ? 0 : 1);
        const tr = typeRank(a.osm_type) - typeRank(b.osm_type);
        if (tr !== 0) return tr;
        return ringArea(b.exterior_ring) - ringArea(a.exterior_ring);
      });
      const pick = els[0];
      return {
        ring: pick.exterior_ring,
        inner: pick.interior_rings,
        osm_id: pick.osm_id,
        osm_type: pick.osm_type,
      };
    }
  }
  return null;
}

async function overpassByBbox(lat: number, lon: number): Promise<{
  ring: [number, number][];
  inner: [number, number][][];
  osm_id: number;
  osm_type: "way" | "relation";
} | null> {
  const q = `[out:json][timeout:25];
(
  way(around:30,${lat},${lon})["building"];
  relation(around:30,${lat},${lon})["building"];
);
out geom;`;
  const j = await callOverpass(q);
  if (!j) return null;
  const els = parseOverpassElements(j);
  if (els.length === 0) return null;
  const pt: [number, number] = [lon, lat];
  // 1) Polígonos que contienen el punto
  const containing = els.filter((e) => pointInRing(pt, e.exterior_ring));
  let pick = containing[0];
  if (containing.length > 1) {
    containing.sort((a, b) => ringArea(a.exterior_ring) - ringArea(b.exterior_ring));
    pick = containing[0]; // el más pequeño que lo contiene
  }
  // 2) Fallback: el más cercano dentro de 8 m
  if (!pick) {
    let best: typeof els[0] | null = null;
    let bestDist = Infinity;
    for (const e of els) {
      const d = distPointToRing(pt, e.exterior_ring);
      if (d < bestDist) { bestDist = d; best = e; }
    }
    if (best && bestDist <= 8) pick = best;
  }
  if (!pick) return null;
  return {
    ring: pick.exterior_ring,
    inner: pick.interior_rings,
    osm_id: pick.osm_id,
    osm_type: pick.osm_type,
  };
}

// ---------- WFS-INSPIRE fallback ----------
async function wfsInspire(rc14: string): Promise<{
  ring: [number, number][];
  inner: [number, number][][];
} | null> {
  const filter =
    `<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc"><ogc:PropertyIsEqualTo><ogc:PropertyName>cp:nationalCadastralReference</ogc:PropertyName><ogc:Literal>${rc14}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>`;
  const url = `https://ovc.catastro.meh.es/INSPIRE/wfsParcel.aspx?service=WFS&version=2.0.0&request=GetFeature&typeNames=cp:CadastralParcel&srsName=EPSG:4326&outputFormat=application/json&Filter=${encodeURIComponent(filter)}`;
  try {
    const r = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    const j = await r.json();
    const f = j?.features?.[0];
    const geom = f?.geometry;
    if (!geom) return null;
    let rings: [number, number][][] | null = null;
    if (geom.type === "Polygon") rings = geom.coordinates;
    else if (geom.type === "MultiPolygon") rings = geom.coordinates?.[0] ?? null;
    if (!rings || rings.length === 0) return null;
    const ring = ensureClosed(rings[0] as [number, number][]);
    if (ring.length < 4) return null;
    const inner = rings
      .slice(1)
      .filter((r) => r && r.length >= 4)
      .map((r) => ensureClosed(r as [number, number][]));
    return { ring, inner };
  } catch {
    return null;
  }
}

// ---------- API pública ----------
export async function fetchParcelGeometry(opts: {
  refcatastral_14: string;
  lat?: number | null;
  lon?: number | null;
  force?: boolean;
  sbAdmin: any;
}): Promise<ParcelGeometry> {
  const rc14 = opts.refcatastral_14;
  const sb = opts.sbAdmin;
  const flags: string[] = [];

  // 1) Caché
  if (!opts.force) {
    const { data: hit } = await sb
      .from("parcel_geometry_cache")
      .select("*")
      .eq("refcatastral_14", rc14)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (hit) {
      return {
        refcatastral_14: rc14,
        exterior_ring: hit.exterior_ring as [number, number][],
        interior_rings: hit.interior_rings as [number, number][][],
        bbox: hit.bbox,
        centroid: hit.centroid,
        area_m2: Number(hit.area_m2 ?? 0),
        perimeter_m: Number(hit.perimeter_m ?? 0),
        source: hit.source as GeometrySource,
        confidence: hit.confidence as "alta" | "media" | "baja",
        flags: (hit.flags as string[]) ?? [],
        osm_id: hit.osm_id ?? undefined,
        osm_type: (hit.osm_type as "way" | "relation" | null) ?? undefined,
        cached: true,
      };
    }
  }

  let result: {
    ring: [number, number][];
    inner: [number, number][][];
    source: GeometrySource;
    confidence: "alta" | "media" | "baja";
    osm_id?: number;
    osm_type?: "way" | "relation";
    raw?: any;
  } | null = null;

  // 2) Overpass por rc14
  try {
    const r = await overpassByRef(rc14);
    if (r) {
      result = { ring: r.ring, inner: r.inner, source: "overpass_ref", confidence: "alta", osm_id: r.osm_id, osm_type: r.osm_type };
    }
  } catch (e) {
    console.warn("overpass ref error", e);
  }

  // 3) Overpass por bbox alrededor del centroide
  if (!result && typeof opts.lat === "number" && typeof opts.lon === "number") {
    try {
      const r = await overpassByBbox(opts.lat, opts.lon);
      if (r) {
        result = { ring: r.ring, inner: r.inner, source: "overpass_bbox", confidence: "media", osm_id: r.osm_id, osm_type: r.osm_type };
        flags.push("geometry_via_bbox");
      }
    } catch (e) {
      console.warn("overpass bbox error", e);
    }
  }

  // 4) WFS-INSPIRE
  if (!result) {
    try {
      const r = await wfsInspire(rc14);
      if (r) {
        result = { ring: r.ring, inner: r.inner, source: "wfs_inspire", confidence: "media" };
      }
    } catch (e) {
      console.warn("wfs-inspire error", e);
    }
  }

  // 5) Fallback geométrico
  if (!result) {
    if (typeof opts.lat !== "number" || typeof opts.lon !== "number") {
      // Sin nada: devolvemos shell mínimo sin persistir.
      return {
        refcatastral_14: rc14,
        exterior_ring: [],
        interior_rings: [],
        bbox: { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 },
        centroid: { lat: 0, lon: 0 },
        area_m2: 0,
        perimeter_m: 0,
        source: "fallback",
        confidence: "baja",
        flags: ["geometry_fallback_estimado", "sin_coordenadas"],
        cached: false,
      };
    }
    // Cuadrado equivalente de 20m alrededor del centroide (placeholder, marca baja).
    const half = 10; // 20m × 20m
    const dLat = half / 111320;
    const dLon = half / (111320 * Math.cos(toRad(opts.lat)));
    const ring: [number, number][] = [
      [opts.lon - dLon, opts.lat - dLat],
      [opts.lon + dLon, opts.lat - dLat],
      [opts.lon + dLon, opts.lat + dLat],
      [opts.lon - dLon, opts.lat + dLat],
      [opts.lon - dLon, opts.lat - dLat],
    ];
    result = { ring, inner: [], source: "fallback", confidence: "baja" };
    flags.push("geometry_fallback_estimado");
  }

  const exterior = result.ring;
  const interior = result.inner;
  const area_m2 = ringArea(exterior);
  const perimeter_m = ringPerimeter(exterior);
  const bbox = bboxOf(exterior);
  const centroid = centroidOf(exterior);

  // Persistir en caché (upsert por rc14)
  try {
    await sb.from("parcel_geometry_cache").upsert({
      refcatastral_14: rc14,
      exterior_ring: exterior,
      interior_rings: interior,
      bbox,
      centroid,
      area_m2,
      perimeter_m,
      source: result.source,
      confidence: result.confidence,
      osm_id: result.osm_id ?? null,
      osm_type: result.osm_type ?? null,
      flags,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString(),
    }, { onConflict: "refcatastral_14" });
  } catch (e) {
    console.warn("parcel cache upsert failed", e);
  }

  return {
    refcatastral_14: rc14,
    exterior_ring: exterior,
    interior_rings: interior,
    bbox,
    centroid,
    area_m2,
    perimeter_m,
    source: result.source,
    confidence: result.confidence,
    flags,
    osm_id: result.osm_id,
    osm_type: result.osm_type,
    cached: false,
  };
}