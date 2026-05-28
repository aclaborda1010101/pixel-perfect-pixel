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

    // -----------------------------------------------------------------
    // Street View: geocodificar la dirección → encontrar panorama más
    // cercano vía Metadata API → calcular heading que apunte al portal.
    // El centroide catastral suele caer en patio interior, y pasar la
    // dirección directamente a /streetview puede enganchar paneles de
    // calles paralelas con la cámara mirando al cielo o a un coche.
    // -----------------------------------------------------------------
    const { data: bldg } = await sb
      .from("buildings")
      .select("direccion, ciudad, codigo_postal")
      .eq("id", building_id)
      .maybeSingle();
    const addressParts = [bldg?.direccion, bldg?.codigo_postal, bldg?.ciudad, "España"]
      .filter(Boolean)
      .join(", ");

    // 1) Geocodificar — preferimos lat/lng del portal a lat/lng catastral
    let portalLat = cat.lat as number;
    let portalLng = cat.lon as number;
    if (addressParts) {
      try {
        const gRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressParts)}&region=es&key=${API_KEY}`,
        );
        const gJson = await gRes.json();
        const loc = gJson?.results?.[0]?.geometry?.location;
        if (loc?.lat && loc?.lng) {
          portalLat = loc.lat;
          portalLng = loc.lng;
        }
      } catch (e) {
        console.warn("geocode failed", e);
      }
    }

    // 2) Metadata API: panorama outdoor más cercano (radio 50m)
    let panoLat = portalLat;
    let panoLng = portalLng;
    let panoId: string | null = null;
    try {
      const mRes = await fetch(
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${portalLat},${portalLng}&radius=50&source=outdoor&key=${API_KEY}`,
      );
      const mJson = await mRes.json();
      if (mJson?.status === "OK" && mJson?.location?.lat && mJson?.location?.lng) {
        panoLat = mJson.location.lat;
        panoLng = mJson.location.lng;
        panoId = mJson.pano_id ?? null;
      }
    } catch (e) {
      console.warn("streetview metadata failed", e);
    }

    // 3) Heading desde el panorama hacia el portal
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const φ1 = toRad(panoLat), φ2 = toRad(portalLat);
    const Δλ = toRad(portalLng - panoLng);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const headingToPortal = (toDeg(Math.atan2(y, x)) + 360) % 360;

    // Si pano y portal coinciden (raro), no podemos calcular un heading
    // útil; fallback a 0/90/180/270.
    const panoSameAsPortal =
      Math.abs(panoLat - portalLat) < 1e-6 && Math.abs(panoLng - portalLng) < 1e-6;

    // Identificador estable para llamar a la API: pano_id si lo tenemos,
    // si no las coords exactas del panorama (evita volver a "saltar").
    const svLocationParam = panoId
      ? `pano=${encodeURIComponent(panoId)}`
      : `location=${panoLat},${panoLng}`;

    // 4 fotos: 2 frontales (heading y heading±15) + 2 laterales para contexto
    const headings: number[] = panoSameAsPortal
      ? [0, 90, 180, 270]
      : [
          headingToPortal,
          (headingToPortal + 345) % 360, // -15º
          (headingToPortal + 15) % 360,
          (headingToPortal + 180) % 360, // contrario (acera de enfrente)
        ];

    const imagenes: any[] = [];
    const skipped: string[] = [];

    const shots = [
      { source: "satellite", url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=satellite&key=${API_KEY}`, name: "satellite.png", heading: null, pitch: null, zoom: 20 },
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=19&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique.png",   heading: null, pitch: null, zoom: 19 },
      // Vistas oblicuas adicionales (rumbos 45º y 225º) — permiten que Gemini vea los patios interiores
      // desde dos ángulos distintos y estime las ventanas exteriores a patio.
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=19&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique_45.png",  heading: 45,  pitch: null, zoom: 19 },
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=19&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique_225.png", heading: 225, pitch: null, zoom: 19 },
      ...headings.map((h) => {
        const rounded = Math.round(h);
        return {
          source: "streetview",
          url: `https://maps.googleapis.com/maps/api/streetview?size=640x640&${svLocationParam}&fov=80&heading=${rounded}&pitch=10&source=outdoor&key=${API_KEY}`,
          name: `streetview_${rounded}.png`,
          heading: rounded,
          pitch: 10,
          zoom: null as number | null,
        };
      }),
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
      const { error: upErr } = await sb.from("building_imagery").upsert({
        building_id,
        source: s.source,
        heading: s.heading,
        pitch: s.pitch,
        zoom: s.zoom,
        file_path: path,
        public_url,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "building_id,file_path" } as any);
      if (upErr) console.error("imagery upsert error", upErr);
      imagenes.push({ source: s.source, public_url, bytes: buf.byteLength });
    }

    await setProcessingStatus(building_id, "google", "ok");
    return json({ imagenes, skipped });
  } catch (e) {
    console.error("fetch-google-imagery error", e);
    return err(String((e as Error).message ?? e));
  }
});