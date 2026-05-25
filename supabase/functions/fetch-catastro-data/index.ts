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
      dnprc_json = { xml_preview: dTxt.slice(0, 5000) };
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