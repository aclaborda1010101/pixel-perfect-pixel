// count-facade-windows-v2 (fachada-v2-multicaptura)
// Variante NO ACTIVA. Cambios respecto al active:
//  (a) 5 capturas por fachada (centro + 2 laterales cerca + 2 oblicuos lejanos)
//  (b) Reconciliación: el VLM elige la FILA de ventanas más visible/completa como
//      referencia para proyectar ejes × plantas (no promedia ruido).
//  (c) Miradores cuentan como 1 eje (regla explícita).
//  (d) Balconeras EXCLUIDAS del conteo en la primera pasada (no segunda pasada).
// NO escribe en facade_window_counts (no toca la variante activa).
// Devuelve { building_id, total, per_facade, vlm_raw, flags, confidence }.

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";
import { fetchParcelGeometry, mergeCollinearRing, type StreetEdge } from "../_shared/parcel_geometry.ts";

const SV_SIZE = "640x640";
const SV_FOV = 110;
const BUCKET = "street-view-captures";

type Planta = { codigo: string; codigo_raw: string; computa_alturas: boolean };

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
function bearing(a: [number, number], b: [number, number]): number {
  const φ1 = toRad(a[1]), φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function offsetMeters(lat: number, lon: number, dx: number, dy: number) {
  const dLat = dy / 111320;
  const dLon = dx / (111320 * Math.cos(toRad(lat)));
  return { lat: lat + dLat, lon: lon + dLon };
}
function offsetAlongBearing(lat: number, lon: number, dist: number, brg: number) {
  return offsetMeters(lat, lon, dist * Math.sin(toRad(brg)), dist * Math.cos(toRad(brg)));
}

async function fetchStreetView(lat: number, lon: number, heading: number, apiKey: string): Promise<ArrayBuffer | null> {
  const url = `https://maps.googleapis.com/maps/api/streetview?size=${SV_SIZE}&location=${lat},${lon}&heading=${heading.toFixed(2)}&fov=${SV_FOV}&pitch=10&source=outdoor&key=${apiKey}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok && r.headers.get("content-type")?.includes("image")) return await r.arrayBuffer();
    } catch { /* ignore */ }
    await new Promise((res) => setTimeout(res, 300 * Math.pow(3, i)));
  }
  return null;
}
async function checkPanorama(lat: number, lon: number, apiKey: string): Promise<boolean> {
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}&radius=30&source=outdoor&key=${apiKey}`);
    const j = await r.json();
    return j?.status === "OK";
  } catch { return false; }
}

function derivePlantas(plantas: Planta[]) {
  const overground = plantas.filter((p) => {
    const c = p.codigo;
    if (c.startsWith("-") || c.startsWith("S")) return false;
    if (c === "CUB" || c === "TZA") return false;
    return true;
  });
  const has_entresuelo = plantas.some((p) => p.codigo === "EN");
  const plantas_tipo_codigos = overground.filter((p) => /^\d{2}$/.test(p.codigo)).map((p) => p.codigo);
  return {
    inferred_floor_count: overground.length,
    has_entresuelo,
    plantas_tipo: plantas_tipo_codigos.length,
    plantas_tipo_codigos,
  };
}

function tryParseJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(t);
  if (fence) t = fence[1].trim();
  const m = /\{[\s\S]*\}/.exec(t);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function callVlmV2(imagesBase64: string[], ctx: {
  plantas_tipo: number;
  has_entresuelo: boolean;
  longitud_m: number | null;
  fachada_label: "principal" | "secundaria";
  n_capturas: number;
}): Promise<{ raw: string; parsed: any | null; status: number }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const prompt = `Arquitecto técnico analizando UNA fachada concreta (la "${ctx.fachada_label}") en Madrid.
Te paso ${ctx.n_capturas} fotos Street View de la MISMA fachada, desde ángulos distintos (centro, lateral cercano izq/der, oblicuo lejano izq/der).

OBJETIVO (variante v2-multicaptura): contar VENTANAS de fachada exterior, EXCLUYENDO BALCONERAS.

DEFINICIONES ESTRICTAS:
- VENTANA = hueco vidriado con ANTEPECHO MACIZO (~90-110 cm), parte baja NO llega al suelo. SÍ cuenta.
- BALCONERA / PUERTA-BALCÓN / BALCÓN FRANCÉS = hueco cuya parte baja LLEGA al suelo y/o tiene barandilla/petril pegado al hueco. NO cuenta en esta variante.
- MIRADOR (bow window saliente acristalado) = 1 EJE (1 ventana por planta tipo), aunque tenga varios paños. Regla vinculante.
- Excluye: puertas de portal/locales, ventanas de escalera, respiraderos, celosías, claraboyas, huecos ciegos, trampantojos.
- Escaparate de local PB grande = 1 hueco.

REGLA DE PROYECCIÓN (vinculante):
1. Identifica los EJES VERTICALES de la fachada (columnas de huecos alineadas de PB a última planta). Cada mirador = 1 eje.
2. Identifica la FILA HORIZONTAL más completa y mejor visible (la planta tipo más despejada en cualquiera de las ${ctx.n_capturas} imágenes). Cuenta cuántos de esos ejes son VENTANAS (no balconeras) en esa fila. Ese número es "ventanas_por_planta_tipo".
3. NO promedies entre fotos. NO restes por oclusión: si un eje está tapado pero ves continuidad arriba, existe. Si una planta tipo COMPLETA está despejada en alguna foto, úsala como referencia.
4. Si ninguna fila completa es legible con seguridad, confianza "baja" y flag "needs_review".

DATOS DE CATASTRO (vinculantes):
- Plantas tipo residenciales (P01..PN): ${ctx.plantas_tipo}
- Tiene entresuelo: ${ctx.has_entresuelo}
- Longitud fachada (m): ${ctx.longitud_m ?? "desconocida"}
- Estás analizando: ${ctx.fachada_label.toUpperCase()}

FÓRMULA:
  ventanas_plantas_tipo = ventanas_por_planta_tipo × ${ctx.plantas_tipo}
  ventanas_planta_baja  = nº ventanas/escaparates en PB de esta fachada (excluye puertas de portal/locales)
  ventanas_entresuelo   = nº ventanas en entresuelo si lo hay, 0 si no
  total                 = ventanas_plantas_tipo + ventanas_planta_baja + ventanas_entresuelo

DEVUELVE EXCLUSIVAMENTE JSON:
{
  "fachada_analizada": "${ctx.fachada_label}",
  "ejes_verticales_detectados": N,
  "ventanas_por_planta_tipo": V,
  "miradores_detectados": M,
  "balconeras_excluidas_por_planta": B,
  "fila_referencia_descripcion": "...",
  "imagen_de_referencia_index": 0..${ctx.n_capturas - 1},
  "ventanas_planta_baja": X,
  "ventanas_entresuelo": Y,
  "ventanas_plantas_tipo": V * ${ctx.plantas_tipo},
  "total": X + Y + V * ${ctx.plantas_tipo},
  "confianza": "alta" | "media" | "baja",
  "flags": [],
  "razon": "..."
}

VALIDACIÓN: total == X + Y + V * ${ctx.plantas_tipo}. Si no, recuenta antes de devolver.`;

  const content: any[] = [{ type: "text", text: prompt }];
  for (const b64 of imagesBase64) {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
  }
  let lastRaw = ""; let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "google/gemini-2.5-pro", messages: [{ role: "user", content }] }),
      });
      lastStatus = r.status;
      const text = await r.text();
      if (r.status === 402 || r.status === 429) {
        return { raw: text, parsed: null, status: r.status };
      }
      let raw = text;
      let upstreamTimeout = false;
      try {
        const j = JSON.parse(text);
        raw = j?.choices?.[0]?.message?.content ?? text;
        const errMsg = j?.choices?.[0]?.error?.message ?? j?.error?.message ?? "";
        if (/timeout|Upstream idle/i.test(String(errMsg))) upstreamTimeout = true;
      } catch { /* keep raw */ }
      lastRaw = raw;
      const parsed = tryParseJson(raw);
      if (parsed && !upstreamTimeout) return { raw, parsed, status: r.status };
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    } catch {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  return { raw: lastRaw, parsed: tryParseJson(lastRaw), status: lastStatus };
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

    const { data: bldg } = await sb
      .from("buildings")
      .select("refcatastral, metadatos, es_esquina_manual, direccion")
      .eq("id", building_id).maybeSingle();
    let rc14 = (bldg?.refcatastral ?? (bldg?.metadatos as any)?.referencia_catastral ?? "")
      .toString().replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14);
    const esEsquinaManual: boolean | null = (bldg?.es_esquina_manual ?? null) as boolean | null;

    let { data: auth } = await sb
      .from("catastro_authority_cache")
      .select("*").eq("refcatastral_14", rc14).maybeSingle();
    if (!auth || !rc14) {
      return json({ building_id, error: "no_authority", needs_review: true }, 200);
    }
    const plantas = (auth.plantas as Planta[]) ?? [];
    const derived = derivePlantas(plantas);
    const centroidLat = auth.lat as number | null;
    const centroidLon = auth.lon as number | null;
    if (!centroidLat || !centroidLon) return json({ building_id, error: "no_centroid", needs_review: true }, 200);
    if (derived.plantas_tipo === 0) flags.push("sin_plantas_tipo");

    const geom = await fetchParcelGeometry({
      refcatastral_14: rc14,
      lat: centroidLat,
      lon: centroidLon,
      force: !!force,
      sbAdmin: sb,
      expected_area_m2: auth.superficie_parcela_m2 as number | null,
    });
    for (const f of geom.flags) if (!flags.includes(f)) flags.push(f);

    type Fachada = {
      role: "principal" | "secundaria";
      edge: StreetEdge;
      captures: { lat: number; lng: number; heading: number; storage_path: string; b64?: string }[];
      vlm_raw: string;
      vlm_parsed: any;
      ejes: number;
      vpt: number; vbp: number; ven: number; vtt: number; total: number;
    };
    const fachadas: Fachada[] = [];
    const street_edges = (geom.street_edges ?? []) as StreetEdge[];
    const es_esquina_geom = !!geom.is_corner;
    const es_esquina_final = esEsquinaManual !== null ? esEsquinaManual : es_esquina_geom;

    if (street_edges.length > 0) {
      const principal = street_edges.find((e) => e.role === "principal") ?? street_edges[0];
      let secundaria = es_esquina_final ? street_edges.find((e) => e.role === "secundaria") : undefined;
      if (es_esquina_final && !secundaria) {
        const rawRing = (geom.exterior_ring ?? []) as [number, number][];
        const ring = mergeCollinearRing(rawRing, 10);
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
              outside_bearing, heading, probes_hit: 0, role: "secundaria",
            } as StreetEdge);
          }
        }
        candidates.sort((x, y) => y.len_m - x.len_m);
        if (candidates[0]) { secundaria = candidates[0]; flags.push("v2_secundaria_inferida"); }
      }
      if (principal) fachadas.push({ role: "principal", edge: principal, captures: [], vlm_raw: "", vlm_parsed: null, ejes: 0, vpt: 0, vbp: 0, ven: 0, vtt: 0, total: 0 });
      if (secundaria) fachadas.push({ role: "secundaria", edge: secundaria, captures: [], vlm_raw: "", vlm_parsed: null, ejes: 0, vpt: 0, vbp: 0, ven: 0, vtt: 0, total: 0 });
    } else {
      flags.push("v2_sin_street_edges");
      return json({ building_id, total: null, needs_review: true, reason: "sin_street_edges", flags }, 200);
    }

    // (C) Multi-captura v2: 5 puntos por fachada
    await Promise.all(fachadas.map(async (f) => {
      const e = f.edge;
      const heading = e.heading;
      const insideBearing = (heading + 180) % 360;
      const tangent = (heading + 90) % 360;
      const midLat = e.midpoint[1], midLon = e.midpoint[0];
      const sideOff = Math.min(8, Math.max(3, e.len_m / 3));
      const center = offsetAlongBearing(midLat, midLon, 8, insideBearing);
      const leftNear = offsetAlongBearing(center.lat, center.lon, sideOff, tangent);
      const rightNear = offsetAlongBearing(center.lat, center.lon, sideOff, (tangent + 180) % 360);
      // oblicuos lejanos: más retirados + desplazados
      const farOff = Math.min(15, Math.max(8, e.len_m / 2));
      const centerFar = offsetAlongBearing(midLat, midLon, 14, insideBearing);
      const leftFar = offsetAlongBearing(centerFar.lat, centerFar.lon, farOff, tangent);
      const rightFar = offsetAlongBearing(centerFar.lat, centerFar.lon, farOff, (tangent + 180) % 360);
      const pts = [
        { p: center, tag: "c" },
        { p: leftNear, tag: "ln" },
        { p: rightNear, tag: "rn" },
        { p: leftFar, tag: "lf" },
        { p: rightFar, tag: "rf" },
      ];
      const results = await Promise.all(pts.map(async ({ p: { lat, lon }, tag }, i) => {
        const storage_path = `${building_id}/v2_${f.role}_${tag}.jpg`;
        let buf: ArrayBuffer | null = null;
        if (!force) {
          const dl = await sb.storage.from(BUCKET).download(storage_path);
          if (!dl.error && dl.data) buf = await dl.data.arrayBuffer();
        }
        if (!buf) {
          const exists = await checkPanorama(lat, lon, apiKey);
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
      if (f.captures.length < 3) flags.push(`v2_cobertura_insuficiente_${f.role}`);
    }));

    // (D) VLM v2 por fachada
    let credits_exhausted = false;
    await Promise.all(fachadas.map(async (f) => {
      if (f.captures.length === 0) {
        flags.push(`v2_sin_capturas_${f.role}`);
        return;
      }
      const res = await callVlmV2(f.captures.map((c) => c.b64!), {
        plantas_tipo: derived.plantas_tipo,
        has_entresuelo: derived.has_entresuelo,
        longitud_m: f.edge.len_m,
        fachada_label: f.role,
        n_capturas: f.captures.length,
      });
      if (res.status === 402) { credits_exhausted = true; return; }
      f.vlm_raw = res.raw; f.vlm_parsed = res.parsed;
      const ejes = Number(res.parsed?.ejes_verticales_detectados ?? 0);
      const vpt = Number(res.parsed?.ventanas_por_planta_tipo ?? 0);
      const vbp = Number.isFinite(Number(res.parsed?.ventanas_planta_baja)) ? Number(res.parsed.ventanas_planta_baja) : 0;
      const ven = Number.isFinite(Number(res.parsed?.ventanas_entresuelo)) ? Number(res.parsed.ventanas_entresuelo) : 0;
      f.ejes = ejes; f.vpt = vpt; f.vbp = vbp; f.ven = ven;
      f.vtt = vpt * derived.plantas_tipo;
      f.total = f.vtt + f.vbp + f.ven;
      if (!res.parsed) flags.push(`v2_vlm_parse_fail_${f.role}`);
      if ((res.parsed?.confianza ?? "baja") === "baja") flags.push(`v2_baja_confianza_${f.role}`);
    }));

    if (credits_exhausted) {
      return json({ building_id, error: "ai_credits_exhausted", status: 402, needs_review: true, flags }, 402);
    }

    const total_ventanas = fachadas.reduce((s, f) => s + f.total, 0);
    const total_or_null = fachadas.every((f) => f.vlm_parsed) && total_ventanas > 0 ? total_ventanas : null;

    return json({
      building_id,
      direccion: bldg?.direccion ?? null,
      total: total_or_null,
      needs_review: total_or_null == null,
      per_facade: fachadas.map((f) => ({
        role: f.role,
        capturas: f.captures.length,
        ejes: f.ejes,
        ventanas_por_planta_tipo: f.vpt,
        ventanas_planta_baja: f.vbp,
        ventanas_entresuelo: f.ven,
        total: f.total,
        confianza: f.vlm_parsed?.confianza ?? null,
        razon: f.vlm_parsed?.razon ?? null,
        imagen_referencia: f.vlm_parsed?.imagen_de_referencia_index ?? null,
        miradores: f.vlm_parsed?.miradores_detectados ?? null,
        balconeras_excluidas: f.vlm_parsed?.balconeras_excluidas_por_planta ?? null,
      })),
      plantas_tipo: derived.plantas_tipo,
      es_esquina: es_esquina_final,
      flags,
    }, 200);
  } catch (e) {
    console.error("count-facade-windows-v2 error", e);
    return err(String((e as Error).message ?? e), 500);
  }
});