// Detector de ESQUINA por geometría catastral (sin depender de nombres de calle OSM).
// Clasifica cada lado del polígono de la parcela:
//   MEDIANERA  -> coincide a ~0 m con el borde de una parcela vecina (pared con vecino)
//   PATIO      -> lado libre que, proyectado hacia fuera, entra en una parcela de la MISMA manzana (patio interior)
//   CALLE      -> lado libre que entra en OTRA manzana (calle confirmada)
//   OPEN       -> lado libre que no entra en ninguna parcela (espacio abierto: plaza/solar) -> ambiguo
// Esquina = existe un giro real (>=30°) entre dos frentes de CALLE contiguos.
//
// Los lados OPEN se resuelven con Google Roads (¿hay calzada real al otro lado?):
//   hay vía -> CALLE confirmada ; no hay vía -> no es calle (patio/solar) -> no cuenta.
// Si no hay API key o Roads falla, el lado OPEN queda sin resolver -> needs_review (humano).
//
// Validado sobre 34 edificios con verdad de campo (~97% bajo criterio "fachadas de parcela",
// falsos positivos ~0). Ver memoria afflux-esquina-detector-catastro.
// Las parcelas llegan en [lon,lat] (igual que fetchBboxParcels / callCatastroCP).
import { fetchBboxParcels } from "./parcel_geometry.ts";

const SHARED_TOL_M = 0.7;     // medianera/manzana: en Catastro coinciden a ~0 m
const MERGE_TURN_DEG = 12;    // fusiona frentes de calle casi alineados (ruido de digitalización)
const CORNER_TURN_MIN = 30;   // giro mínimo de fachada para ser esquina
const CORNER_TURN_MAX = 155;  // por encima = casi vuelta atrás, no esquina
const MIN_EDGE_M = 2.0;       // ignora spurs cortos
const PROBE_MAX_M = 32;       // sondeo hacia fuera para clasificar calle/patio
const PROBE_STEP_M = 1.5;
const ROADS_QUERY_OFFSET_M = 8;  // punto donde se pregunta a Google Roads (dentro de la supuesta calle)
const ROADS_HIT_TOL_M = 14;      // hay vía si Roads engancha a <=14 m

type Pt = [number, number]; // [x,y] en metros (tras proyectar)
type GeoPt = [number, number]; // [lon,lat]
type Poly = { exterior: [number, number][]; interiors: [number, number][][] };

export type CornerResult = {
  is_corner: boolean;
  needs_review: boolean;
  corner_type: "esquina_angulo" | "linea" | "indeterminado";
  street_fronts: number;
  max_turn_deg: number;
  n_calle: number;
  n_patio: number;
  n_open: number;
  block_size: number;
  neighbors: number;
  roads_used: boolean;
  method: "catastro_geom" | "catastro_geom+roads";
};

function projector(lat0: number, lon0: number) {
  const mLat = 111320, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return (p: [number, number]): Pt => [(p[0] - lon0) * mLon, (p[1] - lat0) * mLat]; // p=[lon,lat]
}
function unproject(lat0: number, lon0: number) {
  const mLat = 111320, mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return (p: Pt): GeoPt => [lon0 + p[0] / mLon, lat0 + p[1] / mLat];
}
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function distPointSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  if (!L) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}
const bearing = (a: Pt, b: Pt) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const angDiff = (x: number) => { x = Math.abs(x) % 360; return x > 180 ? 360 - x : x; };
function pip(pt: Pt, ring: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
function minDistToParcel(p: Pt, rings: Pt[][]): number {
  let md = Infinity;
  for (const r of rings) for (let i = 0; i + 1 < r.length; i++) { const d = distPointSeg(p, r[i], r[i + 1]); if (d < md) md = d; }
  return md;
}
function shareBoundary(A: Pt[][], B: Pt[][]): boolean {
  for (const ra of A) for (let i = 0; i + 1 < ra.length; i++) {
    const mid: Pt = [(ra[i][0] + ra[i + 1][0]) / 2, (ra[i][1] + ra[i + 1][1]) / 2];
    if (minDistToParcel(mid, B) < SHARED_TOL_M) return true;
  }
  return false;
}
function haversine(a: GeoPt, b: GeoPt): number {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const la1 = a[1] * toR, la2 = b[1] * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Edge = {
  a: Pt; b: Pt; len: number; bearing: number;
  cls: "MED" | "PATIO" | "CALLE"; hit: "OTHER" | "SAME" | "OPEN" | "-";
  geoOut?: GeoPt; // punto hacia fuera (para consultar Google Roads en lados OPEN)
};

// Construye los lados clasificados (sin Roads todavía). Devuelve edges + nº de vecinos.
function buildEdges(parcelsM: Pt[][][], ti: number, lat0: number, lon0: number): { edges: Edge[]; neighbors: number } {
  const target = parcelsM[ti];
  const others = parcelsM.map((rings, i) => ({ rings, i })).filter((o) => o.i !== ti);
  const unproj = unproject(lat0, lon0);

  // manzana del objetivo: flood-fill por borde compartido
  const block = new Set<number>([ti]);
  let added = true;
  while (added) {
    added = false;
    for (const o of others) {
      if (block.has(o.i)) continue;
      for (const bIdx of block) {
        if (shareBoundary(parcelsM[o.i], parcelsM[bIdx])) { block.add(o.i); added = true; break; }
      }
    }
  }

  const ext = target.reduce((a, b) => (b.length > a.length ? b : a));
  let sx = 0, sy = 0;
  for (const p of ext) { sx += p[0]; sy += p[1]; }
  const cT: Pt = [sx / ext.length, sy / ext.length];

  const edges: Edge[] = [];
  for (let i = 0; i + 1 < ext.length; i++) {
    const a = ext[i], b = ext[i + 1], len = dist(a, b);
    if (len < 0.3) continue;
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let near = 0;
    for (const t of [0.3, 0.5, 0.7]) {
      const s: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      let md = Infinity;
      for (const o of others) { const d = minDistToParcel(s, parcelsM[o.i]); if (d < md) md = d; }
      if (md < SHARED_TOL_M) near++;
    }
    if (near >= 2) { edges.push({ a, b, len, bearing: bearing(a, b), cls: "MED", hit: "-" }); continue; }
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const out = dist([mid[0] + nx, mid[1] + ny], cT) > dist([mid[0] - nx, mid[1] - ny], cT) ? 1 : -1;
    nx *= out; ny *= out;
    let hitId: number | null = null;
    for (let d = PROBE_STEP_M; d <= PROBE_MAX_M; d += PROBE_STEP_M) {
      const pp: Pt = [mid[0] + nx * d, mid[1] + ny * d];
      let hit: number | null = null;
      for (const o of [{ i: ti }, ...others]) {
        for (const r of parcelsM[o.i]) { if (pip(pp, r)) { hit = o.i; break; } }
        if (hit !== null) break;
      }
      if (hit !== null && hit !== ti) { hitId = hit; break; }
    }
    if (hitId === null) {
      const qp: Pt = [mid[0] + nx * ROADS_QUERY_OFFSET_M, mid[1] + ny * ROADS_QUERY_OFFSET_M];
      edges.push({ a, b, len, bearing: bearing(a, b), cls: "CALLE", hit: "OPEN", geoOut: unproj(qp) });
    } else if (block.has(hitId)) edges.push({ a, b, len, bearing: bearing(a, b), cls: "PATIO", hit: "SAME" });
    else edges.push({ a, b, len, bearing: bearing(a, b), cls: "CALLE", hit: "OTHER" });
  }
  return { edges, neighbors: parcelsM.length - 1 };
}

function decide(edges: Edge[], neighbors: number, roadsUsed: boolean): CornerResult {
  function corner(streetPred: (e: Edge) => boolean) {
    const isS = (e: Edge) => e.cls === "CALLE" && streetPred(e) && e.len >= 0.3;
    const merged: Edge[] = [];
    for (const e of edges) {
      const last = merged[merged.length - 1];
      if (last && isS(last) && isS(e) && angDiff(e.bearing - last.bearing) < MERGE_TURN_DEG) {
        last.b = e.b; last.len = dist(last.a, last.b); last.bearing = bearing(last.a, last.b);
      } else merged.push({ ...e });
    }
    const runs: Edge[][] = [];
    let cur: Edge[] | null = null;
    for (const e of merged) {
      if (isS(e) && e.len >= MIN_EDGE_M) { cur ? cur.push(e) : (cur = [e]); }
      else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    let mt = 0, cv = 0;
    for (const run of runs) for (let i = 1; i < run.length; i++) {
      const t = angDiff(run[i].bearing - run[i - 1].bearing);
      if (t > mt) mt = t;
      if (t >= CORNER_TURN_MIN && t <= CORNER_TURN_MAX) cv++;
    }
    return { isCorner: cv >= 1, maxTurn: Math.round(mt), fronts: runs.length };
  }
  const all = corner(() => true);                   // incluye calles OPEN sin resolver
  const strict = corner((e) => e.hit !== "OPEN");   // solo calles ya confirmadas (OTHER, o OPEN resuelto a CALLE)
  const confident = all.isCorner === strict.isCorner;
  const nOpen = edges.filter((e) => e.cls === "CALLE" && e.hit === "OPEN").length;
  const needs_review = !confident || neighbors < 1;
  return {
    is_corner: all.isCorner,
    needs_review,
    corner_type: all.isCorner ? "esquina_angulo" : "linea",
    street_fronts: all.fronts,
    max_turn_deg: all.maxTurn,
    n_calle: edges.filter((e) => e.cls === "CALLE").length,
    n_patio: edges.filter((e) => e.cls === "PATIO").length,
    n_open: nOpen,
    block_size: 0,
    neighbors,
    roads_used: roadsUsed,
    method: roadsUsed ? "catastro_geom+roads" : "catastro_geom",
  };
}

// ¿Hay calzada real cerca del punto? (Google Roads nearestRoads)
async function roadNearby(geo: GeoPt, key: string): Promise<boolean | null> {
  const url = `https://roads.googleapis.com/v1/nearestRoads?points=${geo[1]},${geo[0]}&key=${key}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const sp = j?.snappedPoints?.[0]?.location;
    if (!sp) return false; // Roads no encontró ninguna vía cerca
    const snapped: GeoPt = [sp.longitude, sp.latitude];
    return haversine(geo, snapped) <= ROADS_HIT_TOL_M;
  } catch {
    return null; // fallo de red -> no resuelto
  } finally {
    clearTimeout(t);
  }
}

// Detector de alto nivel: descarga parcela + colindantes, clasifica lados,
// resuelve lados OPEN con Google Roads si hay key, y decide esquina.
export async function detectCornerCatastro(
  lat: number,
  lon: number,
  googleKey?: string | null,
): Promise<CornerResult | null> {
  const polys = await fetchBboxParcels(lat, lon, 32);
  if (!polys || polys.length === 0) return null;
  const P = projector(lat, lon);
  const parcelsM: Pt[][][] = polys.map((poly: Poly) =>
    [poly.exterior, ...poly.interiors].map((r) => r.map((pt) => P(pt as [number, number])))
  );
  const origin: Pt = [0, 0];
  let ti = parcelsM.findIndex((rings) => pip(origin, rings[0]));
  if (ti < 0) {
    let best = Infinity;
    for (let i = 0; i < parcelsM.length; i++) {
      const d = minDistToParcel(origin, parcelsM[i]);
      if (d < best) { best = d; ti = i; }
    }
  }
  if (ti < 0) return null;

  const { edges, neighbors } = buildEdges(parcelsM, ti, lat, lon);

  // Resolver lados OPEN con Google Roads (en paralelo) si hay key.
  let roadsUsed = false;
  const opens = edges.filter((e) => e.hit === "OPEN" && e.geoOut);
  if (googleKey && opens.length > 0) {
    roadsUsed = true;
    await Promise.all(opens.map(async (e) => {
      const hasRoad = await roadNearby(e.geoOut!, googleKey);
      if (hasRoad === true) { e.hit = "OTHER"; e.cls = "CALLE"; }       // calle confirmada
      else if (hasRoad === false) { e.hit = "SAME"; e.cls = "PATIO"; }  // sin vía -> no cuenta
      // null (fallo) -> se queda OPEN -> needs_review
    }));
  }

  return decide(edges, neighbors, roadsUsed);
}

// ---- Plan de captura de fachada (heading frontal por geometría) ----
// Devuelve, para la(s) fachada(s) a CALLE más larga(s), la posición de cámara en la
// calle + el heading que ENCARA la fachada. Resuelve el bug del detector de ventanas
// (capturas "calle abajo"). Validado: produce vistas frontales donde antes salían oblicuas.
export type FacadeShot = {
  role: "principal" | "secundaria";
  camLat: number; camLon: number; heading: number; len_m: number;
};

export async function facadeCapturePlan(
  lat: number,
  lon: number,
  streetOffsetM = 9,
): Promise<FacadeShot[] | null> {
  const polys = await fetchBboxParcels(lat, lon, 32);
  if (!polys || polys.length === 0) return null;
  const P = projector(lat, lon);
  const U = unproject(lat, lon);
  const parcelsM: Pt[][][] = polys.map((poly: Poly) =>
    [poly.exterior, ...poly.interiors].map((r) => r.map((pt) => P(pt as [number, number])))
  );
  let ti = parcelsM.findIndex((rings) => pip([0, 0], rings[0]));
  if (ti < 0) {
    let best = Infinity;
    for (let i = 0; i < parcelsM.length; i++) {
      const d = minDistToParcel([0, 0], parcelsM[i]);
      if (d < best) { best = d; ti = i; }
    }
  }
  if (ti < 0) return null;

  const target = parcelsM[ti];
  const others = parcelsM.map((rings, i) => ({ rings, i })).filter((o) => o.i !== ti);
  // manzana del objetivo (para excluir patios interiores)
  const block = new Set<number>([ti]);
  let added = true;
  while (added) {
    added = false;
    for (const o of others) {
      if (block.has(o.i)) continue;
      for (const b of block) {
        if (shareBoundary(parcelsM[o.i], parcelsM[b])) { block.add(o.i); added = true; break; }
      }
    }
  }
  const ext = target.reduce((a, b) => (b.length > a.length ? b : a));
  let sx = 0, sy = 0;
  for (const p of ext) { sx += p[0]; sy += p[1]; }
  const cT: Pt = [sx / ext.length, sy / ext.length];

  type Cand = { len: number; bearing: number; camLat: number; camLon: number; heading: number };
  const calle: Cand[] = [];
  for (let i = 0; i + 1 < ext.length; i++) {
    const a = ext[i], b = ext[i + 1], len = dist(a, b);
    if (len < 2) continue;
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let near = 0;
    for (const t of [0.3, 0.5, 0.7]) {
      const s: Pt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      let md = Infinity;
      for (const o of others) { const d = minDistToParcel(s, parcelsM[o.i]); if (d < md) md = d; }
      if (md < SHARED_TOL_M) near++;
    }
    if (near >= 2) continue; // medianera
    let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const out = dist([mid[0] + nx, mid[1] + ny], cT) > dist([mid[0] - nx, mid[1] - ny], cT) ? 1 : -1;
    nx *= out; ny *= out;
    // ¿patio interior? (choca con parcela de la misma manzana)
    let hitId: number | null = null;
    for (let d = PROBE_STEP_M; d <= PROBE_MAX_M; d += PROBE_STEP_M) {
      const pp: Pt = [mid[0] + nx * d, mid[1] + ny * d];
      let hit: number | null = null;
      for (const o of [{ i: ti }, ...others]) {
        for (const r of parcelsM[o.i]) { if (pip(pp, r)) { hit = o.i; break; } }
        if (hit !== null) break;
      }
      if (hit !== null && hit !== ti) { hitId = hit; break; }
    }
    if (hitId !== null && block.has(hitId)) continue; // patio
    // cámara en la calle + heading que encara la fachada
    const cam: Pt = [mid[0] + nx * streetOffsetM, mid[1] + ny * streetOffsetM];
    const [camLat, camLon] = U(cam);
    const dx = mid[0] - cam[0], dy = mid[1] - cam[1];
    const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360; // compás (0=N,90=E)
    calle.push({ len, bearing: bearing(a, b), camLat, camLon, heading });
  }
  if (!calle.length) return null;
  calle.sort((a, b) => b.len - a.len);
  const principal = calle[0];
  const out: FacadeShot[] = [{ role: "principal", camLat: principal.camLat, camLon: principal.camLon, heading: principal.heading, len_m: Math.round(principal.len) }];
  // secundaria: la siguiente CALLE más larga no paralela (ángulo 50-130° con la principal)
  for (let i = 1; i < calle.length; i++) {
    const sep = angDiff(calle[i].bearing - principal.bearing);
    const a = sep > 90 ? 180 - sep : sep;
    if (a >= 50 && a <= 130) {
      out.push({ role: "secundaria", camLat: calle[i].camLat, camLon: calle[i].camLon, heading: calle[i].heading, len_m: Math.round(calle[i].len) });
      break;
    }
  }
  return out;
}
