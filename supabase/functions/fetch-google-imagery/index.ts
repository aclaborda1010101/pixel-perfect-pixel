import { corsHeaders, err, getServiceClient, getSetting, json, setProcessingStatus } from "../_shared/scoring_v2_common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.ping) {
      const API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
      if (!API_KEY) return json({ ok: false, reason: "no_key" });
      const r = await fetch(`https://maps.googleapis.com/maps/api/staticmap?center=Madrid&zoom=14&size=64x64&key=${API_KEY}`);
      return json({ ok: r.ok, status: r.status });
    }
    const { building_id } = body;
    if (!building_id) return err("building_id requerido", 400);

    const API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!API_KEY) {
      await setProcessingStatus(building_id, "google", "error", "GOOGLE_MAPS_API_KEY no configurada");
      return err("GOOGLE_MAPS_API_KEY no configurada en secrets", 400);
    }

    const sb = getServiceClient();
    await setProcessingStatus(building_id, "google", "running");

    const { data: cat } = await sb
      .from("catastro_data")
      .select("lat, lon, refcatastral")
      .eq("building_id", building_id)
      .maybeSingle();
    if (!cat?.lat || !cat?.lon) {
      await setProcessingStatus(building_id, "google", "error", "sin coordenadas; ejecuta Catastro primero");
      return err("Sin coordenadas. Ejecuta fetch-catastro-data primero", 400);
    }

    const center = `${cat.lat},${cat.lon}`;
    const imagenes: any[] = [];
    const skipped: string[] = [];

    const shots = [
      { source: "satellite", url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=satellite&key=${API_KEY}`, name: "satellite.png", heading: null, pitch: null, zoom: 20 },
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=19&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique.png",   heading: null, pitch: null, zoom: 19 },
      ...[0, 90, 180, 270].map((h) => ({
        source: "streetview",
        url: `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${center}&fov=80&heading=${h}&pitch=10&key=${API_KEY}`,
        name: `streetview_${h}.png`,
        heading: h, pitch: 10, zoom: null as number | null,
      })),
    ];

    for (const s of shots) {
      const r = await fetch(s.url);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength < 5000) { skipped.push(s.name); continue; }
      const path = `${building_id}/${s.name}`;
      await sb.storage.from("building_imagery").upload(path, buf, {
        contentType: "image/png", upsert: true,
      });
      const public_url = sb.storage.from("building_imagery").getPublicUrl(path).data.publicUrl;
      await sb.from("building_imagery").upsert({
        building_id,
        source: s.source,
        heading: s.heading,
        pitch: s.pitch,
        zoom: s.zoom,
        file_path: path,
        public_url,
      }, { onConflict: "file_path" } as any).catch(async () => {
        // si no hay constraint unique en file_path, insert simple
        await sb.from("building_imagery").insert({
          building_id, source: s.source, heading: s.heading, pitch: s.pitch, zoom: s.zoom,
          file_path: path, public_url,
        });
      });
      imagenes.push({ source: s.source, public_url, bytes: buf.byteLength });
    }

    await setProcessingStatus(building_id, "google", "ok");
    return json({ imagenes, skipped });
  } catch (e) {
    console.error("fetch-google-imagery error", e);
    return err(String((e as Error).message ?? e));
  }
});