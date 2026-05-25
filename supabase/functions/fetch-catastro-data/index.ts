import { corsHeaders, err, getServiceClient, json, setProcessingStatus, sleep } from "../_shared/scoring_v2_common.ts";

const NOMINATIM_UA = "AffluxProperty/1.0 (acifuentes@abius.es)";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const { building_id, force } = await req.json();
    if (!building_id) return err("building_id requerido", 400);

    const sb = getServiceClient();
    await setProcessingStatus(building_id, "catastro", "running");

    const { data: b } = await sb
      .from("buildings")
      .select("id, direccion, ciudad, refcatastral, metadatos")
      .eq("id", building_id)
      .maybeSingle();
    if (!b) {
      await setProcessingStatus(building_id, "catastro", "error", "building no encontrado");
      return err("building no encontrado", 404);
    }

    // Si ya tenemos refcatastral y no se pide force, devolver cache
    let refcat: string | null = b.refcatastral
      ?? (b.metadatos as any)?.referencia_catastral
      ?? null;

    // 1. Si no hay refcatastral: geocodificar + RCCOOR
    if (!refcat || force) {
      const direccion = b.direccion;
      if (!direccion) {
        await setProcessingStatus(building_id, "catastro", "error", "sin dirección");
        return err("building sin dirección para geocodificar", 400);
      }
      const q = encodeURIComponent(`${direccion}, ${b.ciudad ?? "Madrid"}, España`);
      const nomRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
        headers: { "User-Agent": NOMINATIM_UA },
      });
      const nom = await nomRes.json();
      await sleep(1100);
      const lat = Number(nom?.[0]?.lat);
      const lon = Number(nom?.[0]?.lon);
      if (!isFinite(lat) || !isFinite(lon)) {
        await setProcessingStatus(building_id, "catastro", "error", "geocoding falló");
        return err("Nominatim no devolvió coordenadas", 422);
      }

      // Catastro RCCOOR (JSON)
      try {
        const rRes = await fetch(
          `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_RCCOOR?Coordenada_X=${lon}&Coordenada_Y=${lat}&SRS=EPSG:4326`,
        );
        const rXml = await rRes.text();
        const pc1 = /<pc1>([^<]+)<\/pc1>/i.exec(rXml)?.[1] ?? "";
        const pc2 = /<pc2>([^<]+)<\/pc2>/i.exec(rXml)?.[1] ?? "";
        refcat = (pc1 + pc2).trim() || null;
      } catch (e) {
        console.warn("RCCOOR fail", e);
      }

      await sb.from("catastro_data").upsert({
        refcatastral: refcat ?? `unknown-${building_id}`,
        building_id,
        lat, lon,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "refcatastral" });

      if (refcat) {
        await sb.from("buildings").update({ refcatastral: refcat }).eq("id", building_id);
      } else {
        await setProcessingStatus(building_id, "catastro", "error", "no se obtuvo refcatastral");
        return json({ status: "no_refcatastral", lat, lon });
      }
    }

    // 2. Descargar SVG del plano (idempotente)
    const svgPath = `${refcat}.svg`;
    const { data: existing } = await sb.storage.from("catastro").list("", { search: svgPath });
    let plano_url: string | null = null;
    if (!existing?.some((f) => f.name === svgPath) || force) {
      try {
        const planoRes = await fetch(
          `https://www1.sedecatastro.gob.es/Cartografia/GeneraGraficoParcela.aspx?refcat=${refcat}&del=&mun=`,
        );
        const planoTxt = await planoRes.text();
        const svgMatch = /<svg[\s\S]*?<\/svg>/i.exec(planoTxt);
        if (svgMatch) {
          const bytes = new TextEncoder().encode(svgMatch[0]);
          await sb.storage.from("catastro").upload(svgPath, bytes, {
            contentType: "image/svg+xml",
            upsert: true,
          });
        }
      } catch (e) {
        console.warn("plano fetch fail", e);
      }
    }
    plano_url = sb.storage.from("catastro").getPublicUrl(svgPath).data.publicUrl;

    // 3. DNPRC datos alfanuméricos
    let dnprc_json: unknown = null;
    try {
      const dRes = await fetch(
        `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${refcat}`,
      );
      const dTxt = await dRes.text();
      dnprc_json = parseDnprcXml(dTxt);
    } catch (e) {
      console.warn("DNPRC fail", e);
    }

    await sb.from("catastro_data").update({
      plano_url,
      dnprc_json,
      fetched_at: new Date().toISOString(),
      fetch_error: null,
    }).eq("refcatastral", refcat);

    await setProcessingStatus(building_id, "catastro", "ok");
    return json({ status: "ok", refcatastral: refcat, plano_url });
  } catch (e) {
    console.error("fetch-catastro-data error", e);
    return err(String((e as Error).message ?? e));
  }
});

// --- DNPRC XML parser ---
function pick(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, "i").exec(xml);
  return m?.[1]?.trim() || null;
}
function pickNum(xml: string, tag: string): number | null {
  const v = pick(xml, tag);
  if (!v) return null;
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
function usoFromCode(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    V: "Vivienda",
    R: "Residencial",
    C: "Comercial",
    O: "Oficinas",
    A: "Almacén",
    P: "Aparcamiento",
    G: "Garaje",
    I: "Industrial",
    K: "Deportivo",
    T: "Espectáculos",
    Y: "Sanidad/Beneficencia",
    E: "Cultural",
    M: "Obras urbanización",
    H: "Hostelería",
    B: "Almacén agrario",
    J: "Industrial agrario",
    Z: "Agrario",
  };
  return map[code.toUpperCase()] ?? code;
}
function parseDnprcXml(xml: string) {
  if (!xml || !xml.trim().startsWith("<")) {
    return { parse_error: "respuesta no XML", xml_preview: xml?.slice(0, 2000) ?? null };
  }
  // dirección oficial (bloque <dt> con <locs>)
  const dirBlock = /<dt[^>]*>[\s\S]*?<\/dt>/i.exec(xml)?.[0] ?? "";
  const tv = pick(dirBlock, "tv");
  const nv = pick(dirBlock, "nv");
  const pnp = pick(dirBlock, "pnp");
  const np = pick(dirBlock, "snp") || pick(dirBlock, "es") || null;
  const cp = pick(dirBlock, "cp");
  const cm = pick(dirBlock, "nm") || pick(dirBlock, "tm");
  const direccion_oficial = [tv, nv, pnp].filter(Boolean).join(" ") +
    (np ? `, ${np}` : "") +
    (cm ? `, ${cm}` : "") +
    (cp ? ` (${cp})` : "");

  // datos del bien inmueble (<debi>)
  const debi = /<debi[^>]*>[\s\S]*?<\/debi>/i.exec(xml)?.[0] ?? "";
  const uso_code = pick(debi, "luso");
  const uso_principal = usoFromCode(uso_code);
  const ano_construccion = pickNum(debi, "ant");
  const superficie_construida = pickNum(debi, "sfc");
  const coef_participacion = pickNum(debi, "cpt");

  // Subparcelas / locales: <lcons> con <lcd> cada uno
  const subparcelas: any[] = [];
  const lconsBlock = /<lcons[^>]*>[\s\S]*?<\/lcons>/i.exec(xml)?.[0] ?? "";
  const lcdMatches = lconsBlock.matchAll(/<lcd[^>]*>[\s\S]*?<\/lcd>/gi);
  for (const m of lcdMatches) {
    const b = m[0];
    subparcelas.push({
      uso: usoFromCode(pick(b, "lcd")) || pick(b, "dt"),
      planta: pick(b, "pt") || pick(b, "lcd"),
      puerta: pick(b, "pu"),
      escalera: pick(b, "es"),
      superficie_m2: pickNum(b, "dfcc") ?? pickNum(b, "sfc"),
    });
  }

  // superficie solar (suelo) en <ssp> o similares
  const superficie_solar = pickNum(xml, "sup") ?? pickNum(xml, "ssp") ?? null;

  // Calcular % terciario (no vivienda)
  let pct_terciario: number | null = null;
  const totalM2 = subparcelas.reduce((s, x) => s + (Number(x.superficie_m2) || 0), 0);
  if (totalM2 > 0) {
    const ter = subparcelas
      .filter((x) => !/vivienda/i.test(x.uso ?? ""))
      .reduce((s, x) => s + (Number(x.superficie_m2) || 0), 0);
    pct_terciario = Number(((ter / totalM2) * 100).toFixed(1));
  }

  // nº plantas distintas según subparcelas
  const plantas_set = new Set(
    subparcelas
      .map((x) => (x.planta ?? "").toString().trim())
      .filter((p) => p && p !== "-"),
  );

  return {
    direccion_oficial: direccion_oficial.replace(/\s+/g, " ").trim() || null,
    uso_principal,
    uso_code,
    ano_construccion,
    superficie_construida,
    superficie_solar,
    coef_participacion,
    num_plantas_catastro: plantas_set.size || null,
    num_subparcelas: subparcelas.length || null,
    pct_terciario,
    subparcelas,
    xml_preview: xml.slice(0, 4000),
  };
}