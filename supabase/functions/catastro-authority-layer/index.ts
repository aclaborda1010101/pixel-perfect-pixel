// catastro-authority-layer
// Capa única, determinista y auditable que consulta Catastro ANTES de invocar
// cualquier proveedor visual (Street View, Aerial View, VLM) y produce un objeto
// normalizado `CatastroAuthority` que el resto del pipeline tratará como verdad base.
//
// Reglas clave:
//  - Solo lee Catastro (DNPRC + CPMRC + RCCOOR). No invoca visión, no infiere ventanas.
//  - Normaliza códigos de planta (BJ/EN/01..N/BC/TZA/CUB) y NO incluye CUB en numero_plantas.
//  - Cachea por refcatastral_14 con TTL de 30 días salvo `force: true`.
//  - Devuelve { authority, from_cache, errors[], flags[] }; nunca lanza 500 si Catastro responde.

import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

const UA = "AffluxProperty/1.0 (acifuentes@abius.es)";
const NOMINATIM_UA = "AffluxProperty/1.0 (acifuentes@abius.es)";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

type Planta = {
  codigo: string;          // p.ej. "BJ", "EN", "01", "BC", "TZA", "CUB"
  codigo_raw: string;      // tal y como vino del XML (pt)
  computa_alturas: boolean; // false para CUB/TZA si solo cubierta
};

type Authority = {
  refcatastral_14: string;
  refcatastral_20: string | null;
  direccion_oficial: string | null;
  lat: number | null;
  lon: number | null;
  numero_plantas: number | null;
  plantas: Planta[];
  viviendas_total: number | null;
  locales_total: number | null;
  garajes_total: number | null;
  ano_construccion: number | null;
  superficie_parcela_m2: number | null;
  usos: { code: string; nombre: string; count: number }[];
  confidence: { plantas: number; viviendas: number };
  flags: string[];
  errors: string[];
};

function pick(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i").exec(xml);
  return m?.[1]?.trim() || null;
}
function pickAll(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map((m) => m[1]);
}
function num(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
// Coordenadas y otros decimales "limpios" (Catastro CPMRC ya usa punto decimal).
function numFloat(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim();
  // Si tiene coma decimal y NO tiene punto, sustituye coma por punto.
  const cleaned = (s.includes(",") && !s.includes(".")) ? s.replace(",", ".") : s;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

// Normaliza códigos de planta de Catastro (campo <pt>) a un código canónico.
function normalizePlantaCodigo(raw: string): { codigo: string; computa_alturas: boolean } {
  const r = (raw || "").toUpperCase().trim();
  if (!r) return { codigo: "??", computa_alturas: false };
  // Sótanos: -1, -2, S1, SS, SO
  if (/^-\d+$/.test(r)) return { codigo: r, computa_alturas: false };
  if (/^S\d*$/.test(r) || r === "SS" || r === "SO" || r === "SM" || r === "SE") {
    return { codigo: r, computa_alturas: false };
  }
  if (r === "BJ" || r === "PB" || r === "B" || r === "00") return { codigo: "BJ", computa_alturas: true };
  if (r === "EN" || r === "ENT" || r === "EP") return { codigo: "EN", computa_alturas: true };
  if (r === "BC" || r === "BAJ-C") return { codigo: "BC", computa_alturas: true };
  if (r === "TZ" || r === "TZA" || r === "AZ" || r === "AZOT") return { codigo: "TZA", computa_alturas: false };
  if (r === "CUB" || r === "C") return { codigo: "CUB", computa_alturas: false };
  // Pisos numéricos: "01", "1", "P1"
  const m = /^P?0*(\d{1,2})$/.exec(r);
  if (m) {
    const n = Number(m[1]);
    if (n === 0) return { codigo: "BJ", computa_alturas: true };
    return { codigo: String(n).padStart(2, "0"), computa_alturas: true };
  }
  return { codigo: r, computa_alturas: false };
}

// Lee bloques <cons> dentro de <lcons>: cada <cons> describe un elemento constructivo
// (vivienda, local, trastero, garaje) ubicado en una planta concreta via <loint><pt>.
// La clase de uso viene en <lcd> (texto): VIVIENDA / LOCAL / ALMACEN / GARAJE / TRASTERO / OFICINA.
function parsePlantasFromDnprc(xml: string): { plantas: Planta[]; usos: Record<string, number> } {
  const plantaMap = new Map<string, Planta>();
  const usos: Record<string, number> = {};
  const consBlocks = pickAll(xml, "cons");
  for (const block of consBlocks) {
    const pt = pick(block, "pt") || "";
    const lcd = (pick(block, "lcd") || "").toUpperCase().trim();
    if (lcd) usos[lcd] = (usos[lcd] ?? 0) + 1;
    if (!pt) continue;
    const { codigo, computa_alturas } = normalizePlantaCodigo(pt);
    if (!plantaMap.has(codigo)) {
      plantaMap.set(codigo, { codigo, codigo_raw: pt, computa_alturas });
    }
  }
  // Orden lógico: sótanos primero, luego BJ, EN, 01..N, BC, TZA, CUB
  const order = (p: Planta) => {
    if (p.codigo.startsWith("-") || /^S/.test(p.codigo)) return -100 + p.codigo.length;
    if (p.codigo === "BJ") return 0;
    if (p.codigo === "EN") return 1;
    if (p.codigo === "BC") return 50;
    if (p.codigo === "TZA") return 90;
    if (p.codigo === "CUB") return 100;
    const n = Number(p.codigo);
    return isFinite(n) ? 10 + n : 200;
  };
  const plantas = [...plantaMap.values()].sort((a, b) => order(a) - order(b));
  return { plantas, usos };
}

function countUsoByLcd(usos: Record<string, number>, matchers: RegExp[]): number {
  let total = 0;
  for (const [k, v] of Object.entries(usos)) {
    if (matchers.some((re) => re.test(k))) total += v;
  }
  return total;
}


async function fetchDnprcByRC(rc: string): Promise<string> {
  const url = `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${encodeURIComponent(rc)}`;
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/xml" } });
  return await r.text();
}

async function fetchCPMRC(rc14: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const r = await fetch(
      `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC?Provincia=&Municipio=&SRS=EPSG:4326&RC=${rc14}`,
      { headers: { "User-Agent": UA } },
    );
    const xml = await r.text();
    console.log("[authority] CPMRC raw (first 600):", xml.slice(0, 600));
    const xcen = numFloat(pick(xml, "xcen"));
    const ycen = numFloat(pick(xml, "ycen"));
    console.log("[authority] CPMRC parsed xcen=", xcen, "ycen=", ycen);
    if (xcen && ycen) return { lat: ycen, lon: xcen };
  } catch (_e) { /* ignore */ }
  return null;
}

async function rccoorFromLatLon(lat: number, lon: number): Promise<string | null> {
  try {
    const r = await fetch(
      `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR?Coordenada_X=${lon}&Coordenada_Y=${lat}&SRS=EPSG:4326`,
      { headers: { "User-Agent": UA } },
    );
    const xml = await r.text();
    const pc1 = pick(xml, "pc1") ?? "";
    const pc2 = pick(xml, "pc2") ?? "";
    const full = (pc1 + pc2).trim();
    return full.length === 14 ? full : null;
  } catch (_e) { return null; }
}

async function geocode(direccion: string, ciudad: string): Promise<{ lat: number; lon: number } | null> {
  const ciudadClean = !ciudad || /^centro|\(\d+\)/i.test(ciudad) ? "Madrid" : ciudad;
  const variants = [
    `${direccion}, ${ciudadClean}, España`,
    `${direccion.replace(/^calle\s+/i, "")}, ${ciudadClean}, España`,
    `${direccion}, Madrid, España`,
  ];
  for (const q of variants) {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { "User-Agent": NOMINATIM_UA } },
      );
      const j = await r.json();
      const lat = Number(j?.[0]?.lat);
      const lon = Number(j?.[0]?.lon);
      if (isFinite(lat) && isFinite(lon)) return { lat, lon };
    } catch (_e) { /* try next */ }
    await new Promise((r) => setTimeout(r, 1100));
  }
  return null;
}

function expand14to20FromXml(xml: string): string | null {
  const rcBlocks = pickAll(xml, "rc");
  for (const b of rcBlocks) {
    const pc1 = pick(b, "pc1") ?? "";
    const pc2 = pick(b, "pc2") ?? "";
    const car = pick(b, "car") ?? "";
    const cc1 = pick(b, "cc1") ?? "";
    const cc2 = pick(b, "cc2") ?? "";
    const full = (pc1 + pc2 + car + cc1 + cc2).trim();
    if (full.length === 20) return full;
  }
  return null;
}

function direccionOficialFromXml(xml: string): string | null {
  const dt = /<dt[^>]*>[\s\S]*?<\/dt>/i.exec(xml)?.[0] ?? "";
  if (!dt) return null;
  const tv = pick(dt, "tv");
  const nv = pick(dt, "nv");
  const pnp = pick(dt, "pnp");
  const np = pick(dt, "snp") || pick(dt, "es") || null;
  const cp = pick(dt, "cp");
  const cm = pick(dt, "nm") || pick(dt, "tm");
  const dir = [tv, nv, pnp].filter(Boolean).join(" ") +
    (np ? `, ${np}` : "") + (cm ? `, ${cm}` : "") + (cp ? ` (${cp})` : "");
  return dir.trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      refcatastral,
      building_id,
      direccion,
      ciudad,
      lat: latIn,
      lon: lonIn,
      force,
    }: {
      refcatastral?: string;
      building_id?: string;
      direccion?: string;
      ciudad?: string;
      lat?: number;
      lon?: number;
      force?: boolean;
    } = body;

    const sb = getServiceClient();
    const flags: string[] = [];
    const errors: string[] = [];

    // 1) Resolver refcatastral_14
    let rc14: string | null = null;
    if (refcatastral) {
      const cleaned = refcatastral.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      if (cleaned.length >= 14) rc14 = cleaned.slice(0, 14);
    }
    if (!rc14 && building_id) {
      const { data: b } = await sb
        .from("buildings")
        .select("refcatastral, direccion, ciudad, metadatos")
        .eq("id", building_id).maybeSingle();
      const fromB = b?.refcatastral ?? (b?.metadatos as any)?.referencia_catastral ?? null;
      if (fromB) rc14 = String(fromB).replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 14);
      // fallback: usar dirección/ciudad de la fila
      if (!rc14 && (direccion ?? b?.direccion)) {
        const dir = direccion ?? b?.direccion ?? "";
        const ciu = ciudad ?? b?.ciudad ?? "Madrid";
        const coord = await geocode(dir, ciu);
        if (coord) {
          flags.push("rc_resolved_via_geocoding");
          rc14 = await rccoorFromLatLon(coord.lat, coord.lon);
        }
      }
    }
    if (!rc14 && direccion) {
      const coord = (latIn != null && lonIn != null) ? { lat: latIn, lon: lonIn } : await geocode(direccion, ciudad ?? "Madrid");
      if (coord) {
        flags.push("rc_resolved_via_geocoding");
        rc14 = await rccoorFromLatLon(coord.lat, coord.lon);
      }
    }

    if (!rc14) {
      return json({
        authority: null,
        from_cache: false,
        errors: ["no_refcatastral_resolvable"],
        flags,
      }, 200);
    }

    // 2) Caché
    if (!force) {
      const { data: cached } = await sb
        .from("catastro_authority_cache")
        .select("*")
        .eq("refcatastral_14", rc14)
        .maybeSingle();
      if (cached && cached.fetched_at && (Date.now() - new Date(cached.fetched_at as string).getTime()) < TTL_MS) {
        const authority: Authority = {
          refcatastral_14: cached.refcatastral_14 as string,
          refcatastral_20: (cached.refcatastral_20 as string) ?? null,
          direccion_oficial: (cached.direccion_oficial as string) ?? null,
          lat: (cached.lat as number) ?? null,
          lon: (cached.lon as number) ?? null,
          numero_plantas: (cached.numero_plantas as number) ?? null,
          plantas: (cached.plantas as Planta[]) ?? [],
          viviendas_total: (cached.viviendas_total as number) ?? null,
          locales_total: (cached.locales_total as number) ?? null,
          garajes_total: (cached.garajes_total as number) ?? null,
          ano_construccion: (cached.ano_construccion as number) ?? null,
          superficie_parcela_m2: (cached.superficie_parcela_m2 as number) ?? null,
          usos: ((cached.usos as any) ?? []) as Authority["usos"],
          confidence: ((cached.confidence as any) ?? { plantas: 0, viviendas: 0 }),
          flags: ((cached.flags as any) ?? []) as string[],
          errors: ((cached.errors as any) ?? []) as string[],
        };
        return json({ authority, from_cache: true, errors: authority.errors, flags: authority.flags }, 200);
      }
    }

    // 3) Llamada principal a DNPRC con rc14 (devuelve TODOS los bienes inmuebles del edificio,
    //    de donde podemos agregar lcons para reconstruir TODAS las plantas).
    const xml = await fetchDnprcByRC(rc14);
    if (!xml || !xml.trim().startsWith("<")) {
      errors.push("dnprc_html_no_xml");
    }
    const rc20 = expand14to20FromXml(xml);
    if (!rc20) flags.push("no_rc20_expansion");

    const { plantas, usos: usosRaw } = parsePlantasFromDnprc(xml);
    const numero_plantas = plantas.filter((p) => p.computa_alturas).length || null;
    const viviendas_total = countUsoByLcd(usosRaw, [/VIVIENDA/]) || null;
    const locales_total = countUsoByLcd(usosRaw, [/LOCAL/, /OFICINA/, /COMERCIO/, /HOSTELER/]) || null;
    const garajes_total = countUsoByLcd(usosRaw, [/GARAJE/, /APARCAMIENTO/, /PARKING/]) || null;
    const ano = num(pick(xml, "ant"));
    const ano_construccion = ano && ano > 1700 && ano < 2100 ? Math.round(ano) : null;
    const superficie = numFloat(pick(xml, "sfc"));

    const direccion_oficial = direccionOficialFromXml(xml);
    let lat: number | null = null, lon: number | null = null;
    const c = await fetchCPMRC(rc14);
    if (c) { lat = c.lat; lon = c.lon; }
    else { flags.push("cpmrc_failed"); }

    if (plantas.length === 0) errors.push("no_plantas_in_dnprc");
    if (!viviendas_total) flags.push("no_viviendas_in_dnprc");

    const usos: Authority["usos"] = Object.entries(usosRaw)
      .map(([code, count]) => ({ code, nombre: code, count }))
      .sort((a, b) => b.count - a.count);

    const confidence = {
      plantas: plantas.length > 0 ? (rc20 ? 0.95 : 0.8) : 0,
      viviendas: viviendas_total ? 0.85 : 0,
    };

    const authority: Authority = {
      refcatastral_14: rc14,
      refcatastral_20: rc20,
      direccion_oficial,
      lat,
      lon,
      numero_plantas,
      plantas,
      viviendas_total,
      locales_total,
      garajes_total,
      ano_construccion,
      superficie_parcela_m2: superficie,
      usos,
      confidence,
      flags,
      errors,
    };

    // 4) Persistir caché
    await sb.from("catastro_authority_cache").upsert({
      refcatastral_14: rc14,
      refcatastral_20: rc20,
      direccion_oficial,
      lat,
      lon,
      numero_plantas,
      plantas: plantas as unknown as object,
      viviendas_total,
      locales_total,
      garajes_total,
      ano_construccion,
      superficie_parcela_m2: superficie,
      usos: usos as unknown as object,
      confidence,
      flags,
      errors,
      payload: { dnprc_xml_preview: xml.slice(0, 4000) },
      fetched_at: new Date().toISOString(),
    }, { onConflict: "refcatastral_14" });

    return json({ authority, from_cache: false, errors, flags }, 200);
  } catch (e) {
    console.error("catastro-authority-layer error", e);
    return json({
      authority: null,
      from_cache: false,
      errors: [String((e as Error).message ?? e)],
      flags: [],
    }, 200);
  }
});