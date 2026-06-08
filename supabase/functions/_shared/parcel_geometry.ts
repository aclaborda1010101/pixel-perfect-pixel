// Módulo compartido: geometría de parcela.
// Orden de fuentes:
//   1) catastro_parcel_ref  (INSPIRE WFS-CP, por refcatastral)
//   2) catastro_parcel_bbox (INSPIRE WFS-CP, por coordenadas)
//   3) overpass_ref         (OSM por ref:catastral)
//   4) overpass_bbox        (OSM por bbox alrededor del centroide)
//   5) wfs_inspire          (servicio antiguo wfsParcel.aspx — fallback)
//   6) fallback             (cuadrado equivalente)
// Cada candidato pasa por validación de área contra el catastro authority.
// Cachea en `parcel_geometry_cache` por rc14, TTL 180 días.

export type GeometrySource =
  | "catastro_parcel_ref"
  | "catastro_parcel_bbox"
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
  street_edges?: StreetEdge[] | null;
  is_corner?: boolean | null;
  total_street_length_m?: number | null;
}

export interface StreetEdge {
  index: number;
  a: [number, number];
  b: [number, number];
  len_m: number;
  bearing: number;          // 0..360 a→b
  midpoint: [number, number];
  outside_bearing: number;  // desde el polígono hacia fuera (calle)
  heading: number;          // heading cámara→fachada
  role?: "principal" | "secundaria";
  probes_hit: number;
  street_source?: "overpass" | "google_roads" | "mixed";
  google_road_name?: string | null;
}

export interface StreetEdgesResult {
  street_edges: StreetEdge[];
  is_corner: boolean;
  total_street_length_m: number;
  corner_angle_deg: number | null;
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

// ---------- Geo helpers para detección de aristas a calle ----------
function toDeg(r: number) { return (r * 180) / Math.PI; }

function bearingDeg(a: [number, number], b: [number, number]): number {
  const φ1 = toRad(a[1]), φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function offsetAlongBearing(lat: number, lon: number, dist_m: number, bearing_deg: number) {
  const dx = dist_m * Math.sin(toRad(bearing_deg));
  const dy = dist_m * Math.cos(toRad(bearing_deg));
  const dLat = dy / 111320;
  const dLon = dx / (111320 * Math.cos(toRad(lat)));
  return { lat: lat + dLat, lon: lon + dLon };
}

function angularDiffDeg(a: number, b: number): number {
  // 0..180 (sin signo)
  let d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

function distPointToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  // Aproximación equirectangular para distancias cortas (<200 m). Devuelve metros.
  const lat0 = (a[1] + b[1]) / 2;
  const mLat = 111320;
  const mLon = 111320 * Math.cos(toRad(lat0));
  const px = p[0] * mLon, py = p[1] * mLat;
  const ax = a[0] * mLon, ay = a[1] * mLat;
  const bx = b[0] * mLon, by = b[1] * mLat;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ---------- Validación de área contra catastro ----------
function validateAreaAgainstCatastro(
  area_m2: number,
  expected_m2: number | null | undefined,
): { ok: boolean; reason: string | null } {
  if (!expected_m2 || expected_m2 <= 0) return { ok: true, reason: null };
  if (area_m2 <= 0) return { ok: false, reason: "area_cero" };
  const ratio = area_m2 / expected_m2;
  if (ratio < 0.5) return { ok: false, reason: `polygon_area_mismatch_catastro (ratio ${ratio.toFixed(2)} <0.5)` };
  const diff = Math.abs(area_m2 - expected_m2) / expected_m2;
  if (diff > 0.4) return { ok: false, reason: `polygon_area_mismatch_catastro (diff ${(diff * 100).toFixed(0)}%)` };
  return { ok: true, reason: null };
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

// Variante rápida: 1 intento por endpoint, timeout corto (8s), sin backoff.
// Usada por detectStreetEdges para no encadenar timeouts de 20s × 3 endpoints.
async function callOverpassFast(query: string, timeoutMs = 8_000): Promise<any | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Accept": "application/json",
          "User-Agent": "AffluxOS/1.0 (geometry-fetch; contact: ops@affluxos.com)",
        },
        body: query,
      }, timeoutMs);
      if (r.ok) return await r.json();
      console.warn(`overpass-fast ${r.status} @ ${endpoint} → next`);
    } catch (e) {
      console.warn(`overpass-fast error @ ${endpoint}: ${(e as Error).message}`);
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

// ---------- Catastro INSPIRE Cadastral Parcels (autoritativo) ----------
// Endpoint oficial DG Catastro: WFS-CP (Cadastral Parcels).
// Devuelve el polígono real de la parcela catastral.
// Soporta GML 3.2.1; intentamos también JSON por si la implementación lo permite.

const CP_ENDPOINT = "https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx";
const CP_HEADERS = {
  "User-Agent": "AffluxOS/1.0 (geometry-fetch; contact: ops@affluxos.com)",
  "Accept": "application/json, application/gml+xml, application/xml, */*",
};

// Detección dinámica de orden de ejes (algunos servicios devuelven lat,lon).
function normalizeLatLonPair(a: number, b: number): [number, number] {
  // Madrid: lat≈40, lon≈-3. Heurística clara.
  if (Math.abs(a) > 30 && Math.abs(b) < 10) return [b, a]; // (lat,lon) → [lon,lat]
  return [a, b];
}

function parsePosListToRing(posList: string): [number, number][] {
  const nums = posList.trim().split(/\s+/).map(Number).filter((n) => isFinite(n));
  const ring: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    ring.push(normalizeLatLonPair(nums[i], nums[i + 1]));
  }
  return ensureClosed(ring);
}

function extractGmlRingsFromXml(xml: string): { exterior: [number, number][]; interiors: [number, number][][] }[] {
  // Devuelve TODOS los polígonos encontrados (puede haber varios features).
  const polys: { exterior: [number, number][]; interiors: [number, number][][] }[] = [];
  // Capturar bloques <gml:Polygon> o <gml:PolygonPatch> (Catastro INSPIRE usa
  // PolygonPatch dentro de Surface/patches en lugar de Polygon clásico).
  const polyRe = /<(?:\w+:)?(?:Polygon|PolygonPatch)[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:Polygon|PolygonPatch)>/g;
  let m: RegExpExecArray | null;
  while ((m = polyRe.exec(xml)) !== null) {
    const body = m[1];
    const extMatch = /<(?:\w+:)?exterior[^>]*>([\s\S]*?)<\/(?:\w+:)?exterior>/.exec(body);
    if (!extMatch) continue;
    const extPosList = /<(?:\w+:)?posList[^>]*>([\s\S]*?)<\/(?:\w+:)?posList>/.exec(extMatch[1])?.[1];
    if (!extPosList) continue;
    const exterior = parsePosListToRing(extPosList);
    if (exterior.length < 4) continue;
    const interiors: [number, number][][] = [];
    const intRe = /<(?:\w+:)?interior[^>]*>([\s\S]*?)<\/(?:\w+:)?interior>/g;
    let im: RegExpExecArray | null;
    while ((im = intRe.exec(body)) !== null) {
      const ip = /<(?:\w+:)?posList[^>]*>([\s\S]*?)<\/(?:\w+:)?posList>/.exec(im[1])?.[1];
      if (!ip) continue;
      const ring = parsePosListToRing(ip);
      if (ring.length >= 4) interiors.push(ring);
    }
    polys.push({ exterior, interiors });
  }
  return polys;
}

// Extrae <cp:areaValue uom="m2">N</cp:areaValue> por cada feature CadastralParcel.
// Devuelve la lista en orden de aparición. Si no encuentra ninguno, devuelve [].
function extractAreaValuesFromXml(xml: string): number[] {
  const out: number[] = [];
  const re = /<(?:\w+:)?areaValue[^>]*>\s*([\d.]+)\s*<\/(?:\w+:)?areaValue>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = Number(m[1]);
    if (isFinite(v) && v > 0) out.push(v);
  }
  return out;
}

async function callCatastroCP(params: Record<string, string>): Promise<{ polys: ReturnType<typeof extractGmlRingsFromXml> } | null> {
  const u = new URL(CP_ENDPOINT);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t0 = Date.now();
      const r = await fetchWithTimeout(u.toString(), { headers: CP_HEADERS });
      const ct0 = r.headers.get("content-type") ?? "";
      console.log(`catastro-CP attempt=${attempt + 1} status=${r.status} ct=${ct0} url=${u.toString()}`);
      if (!r.ok) {
        console.warn(`catastro-CP ${r.status} attempt ${attempt + 1}`);
        await new Promise((res) => setTimeout(res, 800 + attempt * 1200));
        continue;
      }
      const ct = r.headers.get("content-type") ?? "";
      const body = await r.text();
      console.log(`catastro-CP bytes=${body.length} ms=${Date.now() - t0} snippet=${body.slice(0, 180).replace(/\s+/g, " ")}`);
      // Soportar JSON o GML/XML.
      if (ct.includes("json")) {
        try {
          const j = JSON.parse(body);
          const out: ReturnType<typeof extractGmlRingsFromXml> = [];
          for (const f of (j?.features ?? [])) {
            const g = f?.geometry;
            if (!g) continue;
            const rings: [number, number][][] = g.type === "Polygon" ? g.coordinates : (g.type === "MultiPolygon" ? g.coordinates?.[0] : null);
            if (!rings || rings.length === 0) continue;
            const exterior = ensureClosed(rings[0] as [number, number][]);
            if (exterior.length < 4) continue;
            const interiors = rings.slice(1)
              .filter((rr) => rr && rr.length >= 4)
              .map((rr) => ensureClosed(rr as [number, number][]));
            out.push({ exterior, interiors });
          }
          if (out.length > 0) return { polys: out };
        } catch (_e) { /* caer a GML */ }
      }
      // Tratar como XML/GML.
      const polys = extractGmlRingsFromXml(body);
      console.log(`catastro-CP parsed polys=${polys.length}`);
      if (polys.length > 0) return { polys };
      return null;
    } catch (e) {
      console.warn(`catastro-CP error attempt ${attempt + 1}: ${(e as Error).message}`);
      await new Promise((res) => setTimeout(res, 800 + attempt * 1200));
    }
  }
  return null;
}

async function catastroParcelByRef(rc14: string): Promise<{ ring: [number, number][]; inner: [number, number][][] } | null> {
  // StoredQuery oficial GetParcel (REFCAT 14). El parámetro Filter es ignorado por
  // este servicio (devuelve todas las parcelas). REFCAT debe ser de 14 chars.
  const refcat = rc14.slice(0, 14).toUpperCase();
  const res = await callCatastroCP({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    STOREDQUERY_ID: "GetParcel",
    REFCAT: refcat,
    srsname: "EPSG:4326",
  });
  if (!res || res.polys.length === 0) return null;
  const sorted = [...res.polys].sort((a, b) => ringArea(b.exterior) - ringArea(a.exterior));
  const pick = sorted[0];
  return { ring: pick.exterior, inner: pick.interiors };
}

async function catastroParcelByBbox(lat: number, lon: number): Promise<{ ring: [number, number][]; inner: [number, number][][] } | null> {
  // BBOX ~30m alrededor del punto. WFS 2.0 espera "minx,miny,maxx,maxy,crs".
  const half = 30; // metros
  const dLat = half / 111320;
  const dLon = half / (111320 * Math.cos(toRad(lat)));
  const minLon = lon - dLon, minLat = lat - dLat;
  const maxLon = lon + dLon, maxLat = lat + dLat;
  const bbox = `${minLon},${minLat},${maxLon},${maxLat},urn:ogc:def:crs:EPSG::4326`;
  // Algunas implementaciones esperan x,y; otras y,x. Probamos primero el orden lon,lat (estándar EPSG:4326 con axisOrder=long,lat habitual en GeoServer):
  let res = await callCatastroCP({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "cp:CadastralParcel",
    srsName: "EPSG:4326",
    bbox,
  });
  if (!res) {
    // Fallback: probar bbox sin urn (algunos servicios catastro lo aceptan así).
    res = await callCatastroCP({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "cp:CadastralParcel",
      srsName: "EPSG:4326",
      bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    });
  }
  if (!res || res.polys.length === 0) return null;
  // Escoger el polígono que contiene el punto; si ninguno, el más cercano.
  const pt: [number, number] = [lon, lat];
  const containing = res.polys.filter((p) => pointInRing(pt, p.exterior));
  let pick = containing[0];
  if (!pick) {
    let bestDist = Infinity;
    for (const p of res.polys) {
      const d = distPointToRing(pt, p.exterior);
      if (d < bestDist) { bestDist = d; pick = p; }
    }
    if (!pick) return null;
  }
  return { ring: pick.exterior, inner: pick.interiors };
}

// ---------- Detección geométrica de aristas a calle + esquina ----------
// Fusiona vértices "ruido" del polígono catastral (chaflanes rasterizados):
// elimina v si el giro entre (prev->v) y (v->next) es <= angleThresholdDeg.
// Devuelve un nuevo anillo cerrado.
export function mergeCollinearRing(
  ring: [number, number][],
  angleThresholdDeg = 10,
): [number, number][] {
  if (ring.length < 4) return ring;
  // trabajamos sobre puntos únicos (sin el cierre duplicado)
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 20) {
    changed = false;
    const out: [number, number][] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const b1 = bearingDeg(prev, cur);
      const b2 = bearingDeg(cur, next);
      const diff = angularDiffDeg(b1, b2); // 0 = recto, 180 = U-turn
      if (diff <= angleThresholdDeg) {
        // colineal → soltamos cur
        changed = true;
        continue;
      }
      out.push(cur);
    }
    pts.length = 0;
    pts.push(...out);
    if (pts.length < 4) break;
  }
  pts.push(pts[0]);
  return pts;
}

export async function detectStreetEdges(
  ring: [number, number][],
  opts: { lat: number; lon: number; padding_m?: number },
): Promise<StreetEdgesResult> {
  if (ring.length < 4) {
    return { street_edges: [], is_corner: false, total_street_length_m: 0, corner_angle_deg: null };
  }
  // Fusiona aristas colineales (chaflanes rasterizados del Catastro) ANTES del
  // probing, para que principal/secundaria reflejen las fachadas reales.
  const mergedRing = mergeCollinearRing(ring, 10);
  console.log("detectStreetEdges merge", JSON.stringify({
    edges_in: ring.length - 1, edges_after_merge: mergedRing.length - 1,
  }));
  const padding = opts.padding_m ?? 25;
  // Bounding box del polígono + padding (metros) → radio Overpass.
  const bb = bboxOf(mergedRing);
  const cLat = (bb.minLat + bb.maxLat) / 2;
  const cLon = (bb.minLon + bb.maxLon) / 2;
  // Radio aproximado en metros desde el centro a la esquina + padding.
  const cornerDist = haversine([cLon, cLat], [bb.maxLon, bb.maxLat]) + padding;
  const radius = Math.max(40, Math.min(120, Math.round(cornerDist)));

  const HIGHWAY_REGEX = "^(primary|secondary|tertiary|residential|living_street|pedestrian|unclassified|service|trunk|motorway|tertiary_link|secondary_link|primary_link)$";
  const q = `[out:json][timeout:8];
(
  way["highway"~"${HIGHWAY_REGEX}"](around:${radius},${cLat},${cLon});
);
out geom;`;
  let highways: { line: [number, number][]; name?: string }[] = [];
  try {
    const j = await callOverpassFast(q, 8_000);
    if (j?.elements) {
      for (const el of j.elements) {
        if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const line = el.geometry.map((p: any) => [p.lon, p.lat] as [number, number]);
        highways.push({ line, name: el.tags?.name });
      }
    }
  } catch (e) {
    console.warn("overpass highways error", (e as Error).message);
  }

  const polyCentroidLL = centroidOf(mergedRing); // {lat, lon}
  const polyCentroidPt: [number, number] = [polyCentroidLL.lon, polyCentroidLL.lat];

  // Distancia mínima de un punto a la red de carreteras (en metros) y nombre.
  const nearestHighway = (pt: [number, number]): { dist: number; name?: string } => {
    let best = Infinity; let bestName: string | undefined;
    for (const h of highways) {
      for (let i = 0; i < h.line.length - 1; i++) {
        const d = distPointToSegment(pt, h.line[i], h.line[i + 1]);
        if (d < best) best = d;
        if (d < best + 0.01) bestName = h.name;
      }
    }
    return { dist: best, name: bestName };
  };

  // Google Roads fallback (nearestRoads) — usado solo si Overpass falla en una arista.
  const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const googleRoadHit = async (lat: number, lon: number): Promise<{ hit: boolean; name?: string }> => {
    if (!googleKey) return { hit: false };
    try {
      // nearestRoads acepta puntos; devuelve placeId si hay road dentro de ~50m.
      const r = await fetchWithTimeout(
        `https://roads.googleapis.com/v1/nearestRoads?points=${lat},${lon}&key=${googleKey}`,
        { headers: { Accept: "application/json" } }, 5_000,
      );
      if (!r.ok) return { hit: false };
      const j = await r.json();
      const sn = j?.snappedPoints?.[0];
      if (!sn?.location) return { hit: false };
      const dist = haversine([lon, lat], [sn.location.longitude, sn.location.latitude]);
      if (dist > 15) return { hit: false };
      // Geocode reverse para nombre de calle (best effort, no bloqueante).
      let name: string | undefined;
      try {
        const gr = await fetchWithTimeout(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${sn.location.latitude},${sn.location.longitude}&result_type=route&key=${googleKey}`,
          { headers: { Accept: "application/json" } }, 4_000,
        );
        if (gr.ok) {
          const gj = await gr.json();
          name = gj?.results?.[0]?.address_components?.find((c: any) => c.types?.includes("route"))?.long_name;
        }
      } catch { /* noop */ }
      return { hit: true, name };
    } catch { return { hit: false }; }
  };

  // Para cada arista del anillo: 3 probes a 15 m hacia fuera; umbral 1/3; fallback Google.
  const street_edges: StreetEdge[] = [];
  const PROBE_OFFSETS = [0.25, 0.5, 0.75];
  const PROBE_DIST_M = 15;
  const HIT_THRESHOLD_M = 12;
  const MIN_HITS_REQUIRED = 1;
  const diag: any[] = [];

  for (let i = 0; i < mergedRing.length - 1; i++) {
    const a = mergedRing[i], b = mergedRing[i + 1];
    const len = haversine(a, b);
    if (len < 1.5) continue; // ignora micro-aristas (vértices ruido)
    const brg = bearingDeg(a, b);
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const normalLeft = (brg - 90 + 360) % 360;
    const normalRight = (brg + 90) % 360;
    // ¿Cuál es "fuera"? Aquella cuya proyección desde el midpoint se aleja del centroide del polígono.
    const pL = offsetAlongBearing(mid[1], mid[0], 5, normalLeft);
    const pR = offsetAlongBearing(mid[1], mid[0], 5, normalRight);
    const dL = haversine([pL.lon, pL.lat], polyCentroidPt);
    const dR = haversine([pR.lon, pR.lat], polyCentroidPt);
    const outsideBearing = dL > dR ? normalLeft : normalRight;

    // 3 probes a lo largo de la arista, desplazados hacia fuera (15 m).
    let hits = 0;
    let osmName: string | undefined;
    const probes: { lat: number; lon: number }[] = [];
    for (const t of PROBE_OFFSETS) {
      const px = a[0] + (b[0] - a[0]) * t;
      const py = a[1] + (b[1] - a[1]) * t;
      const probe = offsetAlongBearing(py, px, PROBE_DIST_M, outsideBearing);
      probes.push(probe);
      if (highways.length > 0) {
        const nh = nearestHighway([probe.lon, probe.lat]);
        if (nh.dist <= HIT_THRESHOLD_M) { hits++; if (!osmName) osmName = nh.name; }
      }
    }
    // Fallback Google Roads: si Overpass no marcó hits, probar el probe central.
    let googleHit = false; let googleName: string | undefined;
    let street_source: "overpass" | "google_roads" | "mixed" | undefined = hits > 0 ? "overpass" : undefined;
    if (hits === 0 && googleKey) {
      const center = probes[1];
      const gr = await googleRoadHit(center.lat, center.lon);
      if (gr.hit) { googleHit = true; googleName = gr.name; hits = 1; street_source = "google_roads"; }
    } else if (hits > 0 && hits < 2 && googleKey) {
      // Reforzar con Google para clasificar mixed.
      const center = probes[1];
      const gr = await googleRoadHit(center.lat, center.lon);
      if (gr.hit) { googleName = gr.name; street_source = "mixed"; }
    }

    diag.push({
      edge_index: i, len_m: Math.round(len * 10) / 10,
      bearing: Math.round(brg), outside_bearing: Math.round(outsideBearing),
      probes_hit_overpass: hits - (googleHit ? 1 : 0),
      google_hit: googleHit,
      street_name: osmName ?? googleName ?? null,
    });

    // heading cámara→fachada: cámara está fuera, mira hacia la fachada → outside+180.
    const heading = (outsideBearing + 180) % 360;
    if (hits >= MIN_HITS_REQUIRED) {
      street_edges.push({
        index: i,
        a, b,
        len_m: len,
        bearing: brg,
        midpoint: mid,
        outside_bearing: outsideBearing,
        heading,
        probes_hit: hits,
        street_source,
        google_road_name: osmName ?? googleName ?? null,
      });
    }
  }
  console.log("detectStreetEdges diag", JSON.stringify({ radius, highways: highways.length, edges_total: mergedRing.length - 1, edges_raw: ring.length - 1, edges_detected: street_edges.length, per_edge: diag }));

  // Orden por longitud descendente.
  street_edges.sort((x, y) => y.len_m - x.len_m);

  let is_corner = false;
  let corner_angle_deg: number | null = null;
  if (street_edges.length >= 2) {
    const principal = street_edges[0];
    principal.role = "principal";
    // Buscar la primera arista cuyo ángulo con la principal esté en [60°, 120°].
    for (let k = 1; k < street_edges.length; k++) {
      const e = street_edges[k];
      const diff = angularDiffDeg(principal.bearing, e.bearing);
      // Normalizamos a 0..90 también (paralelas dan ~0 o ~180; perpendiculares ~90).
      const norm = Math.min(diff, 180 - diff);
      const sep = diff > 90 ? 180 - diff : diff; // ángulo entre rectas
      if (sep >= 60 && sep <= 120) {
        e.role = "secundaria";
        is_corner = true;
        corner_angle_deg = Math.round(sep);
        break;
      }
      // Evita warnings TS de variable no usada.
      void norm;
    }
  } else if (street_edges.length === 1) {
    street_edges[0].role = "principal";
  }

  const total_street_length_m = street_edges.reduce((s, e) => s + e.len_m, 0);
  return { street_edges, is_corner, total_street_length_m, corner_angle_deg };
}

// ---------- API pública ----------
export async function fetchParcelGeometry(opts: {
  refcatastral_14: string;
  lat?: number | null;
  lon?: number | null;
  force?: boolean;
  sbAdmin: any;
  expected_area_m2?: number | null;
}): Promise<ParcelGeometry> {
  const rc14 = opts.refcatastral_14;
  const sb = opts.sbAdmin;
  const flags: string[] = [];
  const expected = opts.expected_area_m2 ?? null;

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
        street_edges: (hit.street_edges_jsonb as StreetEdge[] | null) ?? null,
        is_corner: (hit.is_corner as boolean | null) ?? null,
        total_street_length_m: hit.total_street_length_m != null ? Number(hit.total_street_length_m) : null,
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
  // Mejor candidato si todos fallan la validación: el de mayor área (más cercano).
  let bestRejected: { result: NonNullable<typeof result>; area: number } | null = null;

  const tryCandidate = (cand: NonNullable<typeof result>): boolean => {
    const a = ringArea(cand.ring);
    const v = validateAreaAgainstCatastro(a, expected);
    if (v.ok) {
      result = cand;
      return true;
    }
    flags.push(v.reason ?? "polygon_area_mismatch_catastro");
    if (!bestRejected || a > bestRejected.area) bestRejected = { result: cand, area: a };
    console.warn(`geom candidate rejected (${cand.source}): area=${a.toFixed(0)} expected=${expected} → ${v.reason}`);
    return false;
  };

  // 1) catastro_parcel por rc14 (INSPIRE Cadastral Parcels — autoritativo)
  try {
    const r = await catastroParcelByRef(rc14);
    if (r && r.ring.length >= 4) {
      // Match exacto por REFCAT vía stored query GetParcel: es la fuente autoritativa
      // de Catastro (DG Catastro). No la sometemos a la validación de área contra el
      // authority cache porque ese valor puede no ser el suelo de parcela.
      const a = ringArea(r.ring);
      const v = validateAreaAgainstCatastro(a, expected);
      if (!v.ok) {
        flags.push("catastro_parcel_ref_area_diverge_authority");
        console.warn(`catastro_parcel_ref area=${a.toFixed(0)} diverge del authority=${expected} (aceptado igualmente, fuente autoritativa)`);
      }
      result = { ring: r.ring, inner: r.inner, source: "catastro_parcel_ref", confidence: "alta" };
    }
  } catch (e) {
    console.warn("catastro_parcel ref error", (e as Error).message);
  }

  // 2) catastro_parcel por coordenadas
  if (!result && typeof opts.lat === "number" && typeof opts.lon === "number") {
    try {
      const r = await catastroParcelByBbox(opts.lat, opts.lon);
      if (r && r.ring.length >= 4) {
        tryCandidate({ ring: r.ring, inner: r.inner, source: "catastro_parcel_bbox", confidence: "alta" });
      }
    } catch (e) {
      console.warn("catastro_parcel bbox error", (e as Error).message);
    }
  }

  // 3) Overpass por rc14
  if (!result) {
    try {
      const r = await overpassByRef(rc14);
      if (r) {
        tryCandidate({ ring: r.ring, inner: r.inner, source: "overpass_ref", confidence: "alta", osm_id: r.osm_id, osm_type: r.osm_type });
      }
    } catch (e) {
      console.warn("overpass ref error", e);
    }
  }

  // 4) Overpass por bbox
  if (!result && typeof opts.lat === "number" && typeof opts.lon === "number") {
    try {
      const r = await overpassByBbox(opts.lat, opts.lon);
      if (r) {
        if (tryCandidate({ ring: r.ring, inner: r.inner, source: "overpass_bbox", confidence: "media", osm_id: r.osm_id, osm_type: r.osm_type })) {
          flags.push("geometry_via_bbox");
        }
      }
    } catch (e) {
      console.warn("overpass bbox error", e);
    }
  }

  // 5) WFS-INSPIRE (legacy wfsParcel.aspx)
  if (!result) {
    try {
      const r = await wfsInspire(rc14);
      if (r) {
        tryCandidate({ ring: r.ring, inner: r.inner, source: "wfs_inspire", confidence: "media" });
      }
    } catch (e) {
      console.warn("wfs-inspire error", e);
    }
  }

  // Si ninguno pasó validación pero hay un candidato → usarlo con confianza baja.
  if (!result && bestRejected) {
    result = bestRejected.result;
    result.confidence = "baja";
    if (!flags.includes("polygon_no_fiable")) flags.push("polygon_no_fiable");
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

  // Detección geométrica de aristas a calle (sólo si la geometría es razonable).
  let street_edges: StreetEdge[] = [];
  let is_corner = false;
  let total_street_length_m = 0;
  if (
    exterior.length >= 4 &&
    result.source !== "fallback"
  ) {
    try {
      const det = await detectStreetEdges(exterior, { lat: centroid.lat, lon: centroid.lon });
      street_edges = det.street_edges;
      is_corner = det.is_corner;
      total_street_length_m = det.total_street_length_m;
      if (det.is_corner) flags.push("esquina_detectada_geometria");
      if (det.street_edges.length === 0) flags.push("sin_aristas_a_calle_detectadas");
    } catch (e) {
      console.warn("detectStreetEdges error", (e as Error).message);
    }
  }

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
      street_edges_jsonb: street_edges,
      is_corner,
      total_street_length_m,
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
    street_edges,
    is_corner,
    total_street_length_m,
  };
}